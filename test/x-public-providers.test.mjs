import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCashClient } from "@zkp2p/cash";
import {
  HDNodeWallet,
  Transaction,
  Interface,
  id,
  parseEther,
  keccak256,
} from "ethers";
import {
  publicXIdentity,
  nearQuote,
  nearStatus,
  signNearDeposit,
  FX_API,
  ONE_CLICK_API,
} from "../scripts/x-public-providers.mjs";
import { createXTaxGiving } from "../scripts/x-tax-giving.mjs";
import { BSC_USDT } from "../scripts/binance-giving.mjs";
import { USDC } from "../scripts/peer-pay.mjs";

const samples = JSON.parse(
  readFileSync(
    new URL("./fixtures/one-click-public-quotes.json", import.meta.url),
  ),
);
const seed = id("offline example only public-provider test");
const wallet = HDNodeWallet.fromSeed(seed).derivePath("m/44'/60'/0'/0/0");
const amount = parseEther("25");
const transfer = new Interface([
  "function transfer(address to,uint256 amount)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
const response = (data, status = 200) => Response.json(data, { status });
function cashWith(payload) {
  return createCashClient({
    environment: "production",
    nearIntents: { fetch: async () => response(payload) },
  });
}
const publicEnv = {
  X_TAX_SEED: seed.slice(2),
  X_TAX_IDENTITY_API: FX_API,
  X_TAX_BRIDGE_API: ONE_CLICK_API,
};
test("public X lookup binds the requested screen name to an exact string ID", async () => {
  const user = { screen_name: "FriEND", id: "2049496063237611520" };
  assert.equal(
    await publicXIdentity("friend", async (url) => {
      assert.equal(url, FX_API + "/2/profile/friend");
      return response({ code: 200, user });
    }),
    user.id,
  );
  for (const invalid of [
    { ...user, id: Number(user.id) },
    { ...user, screen_name: "someone_else" },
  ])
    await assert.rejects(
      publicXIdentity("friend", async () =>
        response({ code: 200, user: invalid }),
      ),
      /X_ACCOUNT_UNVERIFIED/,
    );
  await assert.rejects(
    publicXIdentity("friend", async () => response({}, 404)),
    /X_ACCOUNT_UNVERIFIED/,
  );
  await assert.rejects(
    publicXIdentity("friend", async () => response({}, 429)),
    /X_LOOKUP_UNAVAILABLE/,
  );
});
test("signed public quote fixes both assets, exact amount and recipient; only live quotes can be signed", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: samples.observed });
  const dry = await nearQuote(
    cashWith(samples.dry),
    wallet.address,
    amount,
    true,
  );
  assert.equal(dry.outputAmount, BigInt(samples.dry.quote.minAmountOut));
  const live = await nearQuote(
    cashWith(samples.fundable),
    wallet.address,
    amount,
    false,
  );
  const signer = {
    address: wallet.address,
    populateTransaction: async (tx) => ({
      ...tx,
      chainId: 56n,
      type: 0,
      nonce: 4,
      gasPrice: 100n,
      gasLimit: 65000n,
    }),
    signTransaction: (tx) => wallet.signTransaction(tx),
  };
  await assert.rejects(signNearDeposit(dry, signer), /X_QUOTE_UNAVAILABLE/);
  const signed = Transaction.from(await signNearDeposit(live, signer));
  assert.equal(signed.from, wallet.address);
  assert.equal(signed.to, BSC_USDT);
  assert.equal(signed.value, 0n);
  assert.equal(signed.chainId, 56n);
  const [to, n] = transfer.decodeFunctionData("transfer", signed.data);
  assert.equal(
    to.toLowerCase(),
    samples.fundable.quote.depositAddress.toLowerCase(),
  );
  assert.equal(n, amount);
  const forged = structuredClone(samples.fundable);
  forged.quote.minAmountOut = String(BigInt(forged.quote.minAmountOut) + 1n);
  await assert.rejects(
    nearQuote(cashWith(forged), wallet.address, amount, false),
  );
  await assert.rejects(
    signNearDeposit(
      { ...live, near: { ...live.near, inputAmount: "1" } },
      signer,
    ),
  );
  t.mock.timers.tick(20 * 60 * 1000);
  await assert.rejects(signNearDeposit(live, signer), /X_QUOTE_UNAVAILABLE/);
});
test("settlement binds provider evidence to the signed quote, source transaction and final output", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: samples.observed });
  const q = await nearQuote(
    cashWith(samples.fundable),
    wallet.address,
    amount,
    false,
  );
  const hash = id("bsc-transaction"),
    dest = id("destination-transaction");
  const details = {
    amountIn: String(amount),
    amountOut: samples.fundable.quote.amountOut,
    originChainTxHashes: [hash],
    destinationChainTxHashes: [dest],
  };
  const result = (swapDetails) =>
    nearStatus(
      cashWith({
        status: "SUCCESS",
        quoteResponse: samples.fundable,
        swapDetails,
      }),
      { near: q.near, hash },
    );
  const s = await result(details);
  assert.equal(s.settledAmount, BigInt(details.amountOut));
  assert.deepEqual(s.txHashes, [dest]);
  await assert.rejects(
    result({ ...details, amountOut: undefined }),
    /X_BRIDGE_REVIEW/,
  );
  await assert.rejects(
    result({ ...details, originChainTxHashes: [dest] }),
    /X_BRIDGE_REVIEW/,
  );
  await assert.rejects(
    result({ ...details, amountOut: "1" }),
    /X_BRIDGE_REVIEW/,
  );
});
test("a signed source deposit survives a lost broadcast response and restart; credit needs matching final Base receipt", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: samples.observed });
  const dir = mkdtempSync(join(tmpdir(), "dark-public-route-"));
  const env = { ...publicEnv, X_TAX_ENABLE: "yes", X_TAX_MAX_USDT: "25" };
  let height = 100,
    settled = false,
    wrongAmount = true,
    recorded = false,
    service;
  const sent = [],
    processor = wallet.deriveChild(1).address,
    baseHash = id("1Click base transaction");
  const txLog = (asset, from, to, n) => ({
    address: asset,
    ...transfer.encodeEventLog("Transfer", [from, to, n]),
  });
  const sourceLog = () =>
    txLog(
      BSC_USDT,
      wallet.address,
      samples.fundable.quote.depositAddress,
      amount,
    );
  const impl = JSON.parse(
    readFileSync(new URL("../public/protocols.json", import.meta.url)),
  )
    .flap.taxImplementation.slice(2)
    .toLowerCase();
  const bsc = {
    getNetwork: async () => ({ chainId: 56n }),
    getBlock: async () => ({ number: height }),
    getCode: async () =>
      "0x363d3d373d3d3d363d73" + impl + "5af43d82803e903d91602b57fd5bf3",
    getLogs: async () => [txLog(BSC_USDT, processor, wallet.address, amount)],
    getBalance: async () => parseEther("0.01"),
    getTransactionCount: async () => 0,
    estimateGas: async () => 65000n,
    getFeeData: async () => ({
      gasPrice: 100n,
      maxFeePerGas: null,
      maxPriorityFeePerGas: null,
    }),
    getTransaction: async () => null,
    getTransactionReceipt: async (hash) =>
      recorded && hash === keccak256(sent[0])
        ? {
            status: 1,
            from: wallet.address,
            blockNumber: 101,
            logs: [sourceLog()],
          }
        : null,
    broadcastTransaction: async (raw) => {
      sent.push(raw);
      throw Error("broadcast response lost");
    },
  };
  const base = {
    getNetwork: async () => ({ chainId: 8453n }),
    getBlock: async () => ({ number: 101 }),
    getBalance: async () => 1n,
    getTransactionReceipt: async (hash) =>
      hash === baseHash
        ? {
            status: 1,
            blockNumber: 101,
            logs: [
              txLog(
                USDC,
                processor,
                wallet.address,
                BigInt(samples.fundable.quote.amountOut) +
                  (wrongAmount ? 1n : 0n),
              ),
            ],
          }
        : null,
  };
  const cash = createCashClient({
    environment: "production",
    nearIntents: {
      fetch: async (url) => {
        if (url.includes("/quote")) return response(samples.fundable);
        if (url.includes("/status"))
          return response({
            status: settled ? "SUCCESS" : "PROCESSING",
            quoteResponse: samples.fundable,
            swapDetails: {
              amountIn: String(amount),
              amountOut: samples.fundable.quote.amountOut,
              originChainTxHashes: [keccak256(sent[0])],
              destinationChainTxHashes: [baseHash],
            },
          });
        return response({});
      },
    },
  });
  const deps = {
    dir,
    cash,
    bsc,
    base,
    resolve: async () => "90001",
    processor: async () => processor,
  };
  t.after(() => {
    service?.close();
    rmSync(dir, { recursive: true, force: true });
  });
  service = createXTaxGiving(publicEnv, deps);
  assert.equal(service.canCheck, true);
  assert.equal(service.enabled, false);
  await assert.rejects(service.bind({}), /X_TAX_UNAVAILABLE/);
  assert.equal(sent.length, 0);
  service.close();
  service = createXTaxGiving(env, deps);
  const ticket = createHmac("sha256", Buffer.from(seed.slice(2), "hex"))
    .update("identity\0" + JSON.stringify(["friend", "90001"]))
    .digest("hex");
  const route = await service.bind({
    recipient: "friend",
    ticket,
    confirmed: true,
    salt: id("fixture new token"),
  });
  assert.equal(route.address, wallet.address);
  height++;
  await service.tick();
  assert.equal(service.status(route.token).stage, "source-deposit");
  assert.equal(sent.length, 0);
  await service.tick();
  assert.equal(sent.length, 1);
  service.close();
  service = createXTaxGiving(env, deps);
  await service.tick();
  assert.deepEqual(sent, [sent[0], sent[0]]);
  recorded = true;
  await service.tick();
  assert.equal(service.status(route.token).stage, "bridge");
  settled = true;
  await service.tick();
  assert.equal(service.status(route.token).stage, "bridge");
  wrongAmount = false;
  await service.tick();
  assert.equal(service.status(route.token).stage, "base");
  assert.equal(service.status(route.token).paid, "0.0");
});

test("sponsored Flap route triggers only on 25 confirmed tax USDT and preserves excess for the next batch", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: samples.observed });
  const dir = mkdtempSync(join(tmpdir(), "dark-tax-threshold-"));
  const sponsor = wallet.deriveChild(8),
    processor = wallet.deriveChild(9).address;
  const impl = JSON.parse(
    readFileSync(new URL("../public/protocols.json", import.meta.url)),
  )
    .flap.taxImplementation.slice(2)
    .toLowerCase();
  let height = 800,
    increment = 0n,
    funded = 0n,
    hash,
    nonce = 0;
  const broadcasts = [];
  const taxLog = (from, n) => ({
    address: BSC_USDT,
    ...transfer.encodeEventLog("Transfer", [from, wallet.address, n]),
  });
  const bsc = {
    getNetwork: async () => ({ chainId: 56n }),
    getBlock: async () => ({ number: height }),
    getCode: async (addr) =>
      addr === wallet.address
        ? "0x"
        : "0x363d3d373d3d3d363d73" + impl + "5af43d82803e903d91602b57fd5bf3",
    getLogs: async () => [
      taxLog(processor, increment),
      taxLog(sponsor.address, parseEther("100")),
    ],
    getBalance: async (who) =>
      who === wallet.address ? funded : parseEther("1"),
    getTransactionCount: async (who) => (who === sponsor.address ? nonce : 0),
    getFeeData: async () => ({ gasPrice: 1000n }),
    estimateGas: async () => 65000n,
    getTransaction: async () => null,
    getTransactionReceipt: async (h) =>
      hash && h === hash
        ? {
            from: sponsor.address,
            to: wallet.address,
            blockNumber: height,
            status: 1,
          }
        : null,
    broadcastTransaction: async (raw) => {
      const tx = Transaction.from(raw);
      broadcasts.push(tx);
      if (tx.from === sponsor.address) {
        hash = tx.hash;
        funded += tx.value;
        nonce++;
      }
    },
  };
  const svc = createXTaxGiving(
    { ...publicEnv, X_TAX_ENABLE: "yes", X_TAX_MAX_USDT: "25" },
    {
      dir,
      bsc,
      base: { getNetwork: async () => ({ chainId: 8453n }) },
      gasKey: sponsor.privateKey,
      processor: async () => processor,
      resolve: async () => "42",
      cash: cashWith(samples.fundable),
    },
  );
  t.after(() => {
    svc.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const ticket = createHmac("sha256", Buffer.from(seed.slice(2), "hex"))
    .update("identity\0" + JSON.stringify(["friend", "42"]))
    .digest("hex");
  const route = await svc.bind({
    recipient: "friend",
    ticket,
    salt: id("threshold launch"),
    confirmed: true,
  });
  increment = parseEther("24.99");
  height++;
  await svc.tick();
  assert.equal(svc.status(route.token).received, "24.99");
  assert.equal(broadcasts.length, 0);
  increment = parseEther("1.01");
  height++;
  await svc.tick();
  assert.equal(svc.status(route.token).received, "26.0");
  assert.equal(svc.status(route.token).issue, "X_GAS_FUNDING");
  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0].from, sponsor.address);
  assert.equal(broadcasts[0].to, route.address);
  await svc.tick();
  assert.equal(svc.status(route.token).stage, "source-deposit");
  await svc.tick();
  assert.equal(broadcasts.length, 2);
  const source = broadcasts[1];
  assert.equal(source.from, wallet.address);
  assert.equal(source.to, BSC_USDT);
  assert.equal(transfer.decodeFunctionData("transfer", source.data)[1], amount);
  assert.equal(svc.status(route.token).paid, "0.0");
});
