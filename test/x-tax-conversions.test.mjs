import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  Interface,
  Wallet,
  ZeroAddress,
  id,
  parseEther,
  parseUnits,
  Transaction,
  keccak256,
  AbiCoder,
} from "ethers";
import { launchChain } from "../scripts/launch-chains.mjs";
import { BSC_USDT } from "../scripts/binance-giving.mjs";
import {
  conversionBook,
  processConversion,
  sourceRevenue,
  WBNB,
  ROUTER,
} from "../scripts/x-tax-conversions.mjs";
const erc = new Interface([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
  "function transfer(address,uint256)",
  "function allowance(address,address) view returns(uint256)",
  "function approve(address,uint256)",
]);
const distributed = new Interface([
  "event FlapTaxProcessorWalletDistributed(address indexed wallet,uint16 bps,uint256 amount)",
]);
const dex = new Interface([
  "function getAmountsOut(uint256,address[]) view returns(uint256[])",
  "function getPair(address,address) view returns(address)",
]);
const u = parseEther;
function event(asset, from, to, amount) {
  return {
    address: asset,
    ...erc.encodeEventLog("Transfer", [from, to, amount]),
  };
}
test("pool accounting isolates successful native Flap distributions, ignores unrelated gas and respects ERC20 units", async () => {
  const processor = Wallet.createRandom().address,
    addr = Wallet.createRandom().address,
    other = Wallet.createRandom().address;
  const native = (address, to, amount) => ({
    address,
    ...distributed.encodeEventLog("FlapTaxProcessorWalletDistributed", [
      to,
      10000,
      amount,
    ]),
  });
  let currency = WBNB,
    logs = [
      native(processor, addr, 12n),
      native(processor, other, 99n),
      native(other, addr, 33n),
    ];
  const p = {
    call: async () =>
      AbiCoder.defaultAbiCoder().encode(["address"], [currency]),
    getLogs: async () => logs,
  };
  assert.equal(
    await sourceRevenue(p, { address: addr }, ZeroAddress, processor, 10, 11),
    12n,
  );
  currency = other;
  logs = [
    event(currency, processor, addr, 123456n),
    event(currency, addr, addr, 333n),
    event(WBNB, processor, addr, 444n),
  ];
  assert.equal(
    await sourceRevenue(p, { address: addr }, currency, processor, 10, 11),
    123456n,
  );
  await assert.rejects(
    sourceRevenue(p, { address: addr }, ZeroAddress, processor, 10, 11),
    /X_POOL_MISMATCH/,
  );
});
for (const chainId of [56, 8453])
for (const kind of ["dex", "operator"])
  for (const native of [true, false]) {
    test(`${chainId} ${kind} ${native ? "BNB" : "6-decimal pool"}: exact funding, restart across lost broadcast, realized USDT once`, async (t) => {
      const cfg = launchChain(chainId), u = v => parseUnits(v, cfg.decimals);
      const db = new DatabaseSync(":memory:");
      t.after(() => db.close());
      db.exec(
        "CREATE TABLE routes(idx INTEGER PRIMARY KEY,address TEXT,token TEXT,received TEXT,chain INTEGER NOT NULL DEFAULT 56); CREATE TABLE batches(route INTEGER,stage TEXT)",
      );
      const wallet = Wallet.createRandom(),
        token = Wallet.createRandom().address,
        operator = Wallet.createRandom().address,
        asset = native ? ZeroAddress : Wallet.createRandom().address,
        pair = Wallet.createRandom().address,
        decimals = native ? 18 : 6;
      const input = parseUnits("0.5", decimals),
        floor = u("25"),
        deposit = id("prefund"),
        settled = u("25.2");
      let book = conversionBook(db);
      const r = { idx: 0, chain: chainId, address: wallet.address, token };
      db.prepare("INSERT INTO routes(idx,address,token,received) VALUES(0,?,?,'0')").run(r.address, token);
      db.prepare("UPDATE routes SET chain=?").run(chainId);
      book.register(
        0,
        { address: asset, symbol: native ? "BNB" : "POOL", decimals },
        4,
      );
      db.prepare("UPDATE poolRevenue SET earned=?").run(String(input * 2n));
      let height = 30,
        rc,
        seen,
        nonce = 0,
        allowance = native ? 0n : 1n,
        price = settled,
        source = operator;
      const funding = () => ({
        status: 1,
        from: source,
        to: cfg.stable,
        blockNumber: 20,
        logs: [event(cfg.stable, source, r.address, floor)],
      });
      const p = {
        getNetwork: async () => ({ chainId: BigInt(chainId) }),
        getBlock: async () => ({ number: height, timestamp: 10000 }),
        getTransactionCount: async () => nonce,
        getFeeData: async () => ({ gasPrice: 1n }),
        estimateGas: async (req) => {
          assert.ok(BigInt(req.value) >= 0n);
          return 80000n;
        },
        call: async (tx) => {
          const selector = tx.data.slice(0, 10);
          if (selector === dex.getFunction("getPair").selector)
            return dex.encodeFunctionResult("getPair", [pair]);
          if (selector === dex.getFunction("getAmountsOut").selector)
            return dex.encodeFunctionResult("getAmountsOut", [[input, price]]);
          return erc.encodeFunctionResult("allowance", [allowance]);
        },
        getTransactionReceipt: async (h) =>
          h === deposit ? funding() : rc?.hash === h ? rc : null,
        getTransaction: async (h) =>
          h === deposit
            ? {
                from: source,
                to: cfg.stable,
                data: erc.encodeFunctionData("transfer", [r.address, floor]),
              }
            : seen === h
              ? {}
              : null,
        broadcastTransaction: async (raw) => {
          const tx = Transaction.from(raw);
          assert.equal(tx.from, r.address);
          seen = keccak256(raw);
          throw Error("test lost response");
        },
      };
      const args = {
        p,
        token,
        amount: "0.5",
        minUSDT: "25",
        operator,
        deposit: kind === "operator" ? deposit : undefined,
        requestId: "test-01",
      };
      const read = () =>
        db.prepare("SELECT received FROM routes WHERE idx=0").get().received;
      const step = () =>
        processConversion({
          book,
          db,
          r,
          p,
          wallet,
          sponsor: {
            ensure: async (chain, idx, raw) => {
              assert.equal(chain, chainId);
              assert.equal(book.active(idx).raw, raw);
            },
          },
        });
      if (kind === "dex") {
        price = floor - 1n;
        await assert.rejects(book.order(args), /PRICE/);
        price = settled;
      } else {
        source = Wallet.createRandom().address;
        await assert.rejects(book.order(args), /INVALID_DEPOSIT/);
        source = operator;
      }
      await assert.rejects(
        book.order({ ...args, amount: "2", commit: true }),
        /UNRESERVED/,
      );
      await book.order(args);
      assert.equal(book.active(0), undefined);
      await book.order({ ...args, commit: true });
      await book.order({ ...args, commit: true });
      while (book.active(0)) {
        await step();
        const j = book.active(0),
          tx = Transaction.from(j.raw);
        assert.equal(tx.nonce, nonce);
        await assert.rejects(step(), /lost response/);
        book = conversionBook(db);
        await step();
        assert.equal(read(), "0");
        if (j.action === "reset" || j.action === "approve")
          allowance = j.action === "approve" ? input : 0n;
        if (j.action === "release")
          assert.equal(
            native ? tx.to : erc.decodeFunctionData("transfer", tx.data)[0],
            operator,
          );
        if (j.action === "swap") assert.equal(tx.to, cfg.router);
        rc = {
          hash: j.hash,
          status: 1,
          blockNumber: height + 1,
          from: r.address,
          to: tx.to,
          logs:
            j.action === "swap"
              ? [
                  event(cfg.stable, pair, r.address, settled),
                  event(cfg.stable, operator, r.address, u("500")),
                ]
              : j.action === "release" && !native
                ? [event(asset, r.address, operator, input)]
                : [],
        };
        await step();
        assert.equal(read(), "0");
        height++;
        nonce++;
        await step();
      }
      assert.equal(await step(), false);
      assert.equal(read(), String(kind === "operator" ? floor : settled));
      assert.equal(book.inventory(0).remaining, "0.5");
      await book.order({ ...args, commit: true });
      assert.equal(book.inventory(0).reserved, "0.0");
      if (kind === "operator")
        await assert.rejects(
          book.order({ ...args, requestId: "test-02", commit: true }),
          /UNIQUE/,
        );
    });
  }
