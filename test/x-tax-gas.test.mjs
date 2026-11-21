import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import ganache from "ganache";
import { BrowserProvider, Wallet, Transaction, parseEther } from "ethers";
import { createGasSponsor, prepareRouteGas } from "../scripts/x-tax-gas.mjs";

for (const chain of [56, 8453])
  test(`chain ${chain}: unfunded route, concurrent workers, lost broadcast response, restart and automatic execution`, async (t) => {
    const payer = Wallet.createRandom(),
      route = Wallet.createRandom();
    const local = ganache.provider({
      chain: { chainId: chain, hardfork: chain === 56 ? "berlin" : "shanghai" },
      miner: { defaultGasPrice: 1000 },
      wallet: {
        accounts: [
          {
            secretKey: payer.privateKey,
            balance: "0x" + parseEther("1").toString(16),
          },
        ],
      },
      logging: { quiet: true },
    });
    const p = new BrowserProvider(local, undefined, { cacheTimeout: -1 });
    const dir = mkdtempSync(join(tmpdir(), "dark-sponsored-"));
    const dbs = [];
    t.after(async () => {
      for (const db of dbs) db.close();
      p.destroy();
      await local.disconnect();
      rmSync(dir, { force: true, recursive: true });
    });
    const options = {
      key: payer.privateKey,
      providers: { [chain]: p },
      routeAddress: (idx) => {
        assert.equal(idx, 0);
        return route.address;
      },
      limits: { [chain]: parseEther("0.02") },
    };
    const open = () => {
      const db = new DatabaseSync(join(dir, "journal.sqlite"));
      dbs.push(db);
      return createGasSponsor({ ...options, db });
    };
    const ledger = open(),
      otherWorker = open();
    // Use the real ABI and a deterministic L1/operator estimate on the Base fork.
    if (chain === 8453)
      await p.send("evm_setAccountCode", [
        "0x420000000000000000000000000000000000000F",
        "0x6103e860005260206000f3",
      ]);
    const call = {
      to: Wallet.createRandom().address,
      data: "0x12345678",
      value: 0n,
    };
    const prepared = await prepareRouteGas(p, chain, route.address, call);
    const raw = await route.signTransaction(prepared);
    assert.equal(await p.getBalance(route.address), 0n);
    const broadcast = p.broadcastTransaction.bind(p),
      sends = [];
    p.broadcastTransaction = async (bytes) => {
      sends.push(bytes);
      if (sends.length === 1) throw Error("lost before submission");
      return broadcast(bytes);
    };
    const initial = await Promise.allSettled([
      ledger.ensure(chain, 0, raw),
      otherWorker.ensure(chain, 0, raw),
    ]);
    assert.ok(initial.some((v) => v.status === "rejected"));
    const restored = open();
    try {
      await restored.resume(chain, 0);
    } catch (e) {
      assert.match(e.message, /X_GAS_FUNDING/);
    }
    await restored.ensure(chain, 0, raw);
    const rows = dbs[0].prepare("SELECT * FROM gasTransfers").all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].state, "confirmed");
    const gas = Transaction.from(rows[0].raw);
    assert.equal(gas.to, route.address);
    assert.equal(gas.from, payer.address);
    assert.equal(gas.data, "0x");
    assert.equal(gas.chainId, BigInt(chain));
    assert.equal(new Set(sends).size, 1);
    const execution =
      prepared.gasLimit * (prepared.maxFeePerGas ?? prepared.gasPrice);
    const budget = execution + (chain === 8453 ? 5000n : 0n);
    assert.equal(gas.value, budget + budget / 10n);
    const receipt = await (await broadcast(raw)).wait();
    assert.equal(receipt.status, 1);
    assert.equal(await p.getTransactionCount(payer.address), 1);
  });

test("sponsorship refuses mismatched routes, expensive gas and insufficient sponsor funds", async (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const payer = Wallet.createRandom(),
    route = Wallet.createRandom(),
    other = Wallet.createRandom();
  const raw = await route.signTransaction({
    to: other.address,
    chainId: 56,
    type: 0,
    nonce: 0,
    gasLimit: 50000n,
    gasPrice: 10n,
  });
  const p = {
    getFeeData: async () => ({ gasPrice: 10n }),
    getBalance: async () => 0n,
    getTransactionCount: async () => 0,
    getCode: async () => "0x",
  };
  const options = {
    db,
    key: payer.privateKey,
    routeAddress: () => route.address,
    providers: { 56: p },
    limits: { 56: 1000000n },
  };
  await assert.rejects(
    createGasSponsor({ ...options, routeAddress: () => other.address }).ensure(
      56,
      0,
      raw,
    ),
    /X_GAS_REVIEW/,
  );
  await assert.rejects(
    createGasSponsor({ ...options, limits: { 56: 1n } }).ensure(56, 0, raw),
    /X_GAS_PRICE_HIGH/,
  );
  await assert.rejects(
    createGasSponsor(options).ensure(56, 0, raw),
    /X_GAS_SPONSOR_LOW/,
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM gasTransfers").get().n, 0);
});

test("BNB tax principal stays reserved through gas sponsorship, including a native conversion", async (t) => {
  const route = Wallet.createRandom(),
    payer = Wallet.createRandom(),
    recipient = Wallet.createRandom().address;
  const principal = parseEther("0.5");
  const local = ganache.provider({
    chain: { chainId: 56, hardfork: "berlin" },
    miner: { defaultGasPrice: 1000 },
    wallet: {
      accounts: [
        {
          secretKey: payer.privateKey,
          balance: "0x" + parseEther("1").toString(16),
        },
        { secretKey: route.privateKey, balance: "0x" + principal.toString(16) },
      ],
    },
    logging: { quiet: true },
  });
  const p = new BrowserProvider(local, undefined, { cacheTimeout: -1 }),
    db = new DatabaseSync(":memory:");
  t.after(async () => {
    db.close();
    p.destroy();
    await local.disconnect();
  });
  const raw = await route.signTransaction(
    await prepareRouteGas(p, 56, route.address, {
      to: recipient,
      value: principal,
      data: "0x",
    }),
  );
  const options = {
    db,
    key: payer.privateKey,
    providers: { 56: p },
    limits: { 56: parseEther("0.01") },
    reservedNative: () => principal,
    routeAddress: () => route.address,
  };
  await assert.rejects(
    createGasSponsor(options).ensure(56, 0, raw),
    /X_GAS_REVIEW/,
  );
  const sponsor = createGasSponsor({
    ...options,
    authorizedNative: (idx, bytes) => idx === 0 && bytes === raw,
  });
  await assert.rejects(sponsor.ensure(56, 0, raw), /X_GAS_FUNDING/);
  await sponsor.ensure(56, 0, raw);
  assert.ok((await p.getBalance(route.address)) > principal);
  await (await p.broadcastTransaction(raw)).wait();
  assert.equal(await p.getBalance(recipient), principal);
});
