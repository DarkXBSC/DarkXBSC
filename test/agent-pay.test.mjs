import { test } from "node:test";
import assert from "node:assert/strict";
import { Interface } from "ethers";
import { planPayments, PAY_NETWORK } from "../src/lib/agent-pay.ts";
import { createPayReader } from "../scripts/agent-pay.mjs";
const address = "0x79e4C8b8E842a48dfCC938f1a152EEF1d34787b3";
const input = {
  received: "1000",
  reserve: "20",
  impactPercent: "50",
  creators: "20",
  perPersonCap: "25",
};
test("USDC allocation conserves every micro-unit and caps each recipient", () => {
  for (const received of ["1000", "1.000001", "999999.999999"]) {
    const p = planPayments({ ...input, received, reserve: "0.000001" });
    const u = p.units;
    assert.equal(
      BigInt(u.received),
      BigInt(u.reserve) +
        BigInt(u.impact) +
        BigInt(u.creatorTotal) +
        BigInt(u.carry),
    );
    assert.ok(BigInt(u.each) <= 25_000_000n);
    assert.equal(p.canExecute, false);
  }
});
test("invalid financial precision, shares and recipient counts fail closed", () => {
  for (const over of [
    { received: "1e6" },
    { received: "1.0000001" },
    { reserve: "1000" },
    { impactPercent: "100.01" },
    { creators: "0" },
    { creators: "1.5" },
    { perPersonCap: "-1" },
  ])
    assert.throws(() => planPayments({ ...input, ...over }));
});
const goodQuote = () => ({
  id: "test-quote",
  tool: "test-provider",
  action: {
    fromChainId: 56,
    toChainId: 8453,
    fromToken: { address: "0x0000000000000000000000000000000000000000" },
    toToken: { address: PAY_NETWORK.usdc, decimals: 6 },
    fromAddress: address,
    toAddress: address,
    fromAmount: "100000000000000000",
  },
  estimate: {
    toAmount: "50000000",
    toAmountMin: "49750000",
    gasCosts: [],
    feeCosts: [],
  },
  transactionRequest: { data: "NEVER_RETURN_UNSIGNED_TX" },
});
const query = {
  asset: "BNB",
  amount: "0.1",
  fromAddress: address,
  toAddress: address,
};
test("quote checks chain, token, recipient, amount and precision; strips execution data", async () => {
  const reader = (q) =>
    createPayReader({
      bscRpc: "https://example.invalid",
      fetcher: async () => ({ ok: true, json: async () => q }),
    });
  const result = await reader(goodQuote()).quote(query);
  assert.equal(result.canExecute, false);
  assert.equal("transactionRequest" in result, false);
  for (const mutate of [
    (q) => (q.action.toChainId = 1),
    (q) => (q.action.toToken.address = address),
    (q) => (q.action.toToken.decimals = 18),
    (q) => (q.action.toAddress = "0x0000000000000000000000000000000000000001"),
    (q) => (q.action.fromAmount = "1"),
    (q) => (q.estimate.toAmountMin = "999999999"),
  ]) {
    const q = goodQuote();
    mutate(q);
    await assert.rejects(
      () => reader(q).quote(query),
      /QUOTE_IDENTITY_MISMATCH/,
    );
  }
});
test("identity cannot accept the wrong chain or missing registry", async () => {
  const r = (result) =>
    createPayReader({
      bscRpc: "https://example.invalid",
      fetcher: async () => ({ ok: true, json: async () => ({ result }) }),
    });
  await assert.rejects(() => r("0x1").identity(address), /WRONG_RPC_CHAIN/);
  await assert.rejects(() => r("0x38").identity("invalid"), /INVALID_ADDRESS/);
});
test("identity check reports public lookup rather than authorization", async () => {
  const erc = new Interface([
    "function balanceOf(address) view returns(uint256)",
  ]);
  const r = createPayReader({
    bscRpc: "https://example.invalid",
    fetcher: async (_url, init) => {
      const { method } = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({
          result: {
            eth_chainId: "0x38",
            eth_blockNumber: "0x100",
            eth_getCode: "0x6000",
            eth_call: erc.encodeFunctionResult("balanceOf", [1]),
          }[method],
        }),
      };
    },
  });
  assert.deepEqual(
    (({ eligible, authentication }) => ({ eligible, authentication }))(
      await r.identity(address),
    ),
    { eligible: true, authentication: false },
  );
});
