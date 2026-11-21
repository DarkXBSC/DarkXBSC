import {
  Interface,
  getAddress,
  isAddress,
  parseUnits,
  ZeroAddress,
} from "ethers";
import { PAY_NETWORK } from "../src/lib/agent-pay.ts";

const erc = new Interface([
  "function balanceOf(address) view returns(uint256)",
  "function decimals() view returns(uint8)",
  "function symbol() view returns(string)",
]);
export const SOURCE_ASSETS = {
  BNB: { address: ZeroAddress, decimals: 18 },
  USDT: { address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
};
const fail = (code) => {
  throw Error(code);
};
export function createPayReader({
  bscRpc,
  baseRpc = "https://mainnet.base.org",
  fetcher = fetch,
}) {
  async function json(url, init = {}) {
    const r = await fetcher(url, {
      ...init,
      signal: AbortSignal.timeout(18000),
    });
    if (!r.ok) fail("UPSTREAM_UNAVAILABLE");
    return r.json();
  }
  async function rpc(url, method, params = []) {
    const r = await json(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (r.error || r.result === undefined) fail("RPC_UNAVAILABLE");
    return r.result;
  }
  async function chain(url, expected) {
    if (BigInt(await rpc(url, "eth_chainId")) !== BigInt(expected))
      fail("WRONG_RPC_CHAIN");
  }
  async function identity(address) {
    if (!isAddress(address) || address === ZeroAddress) fail("INVALID_ADDRESS");
    await chain(bscRpc, 56);
    const block = await rpc(bscRpc, "eth_blockNumber");
    const code = await rpc(bscRpc, "eth_getCode", [PAY_NETWORK.agentId, block]);
    if (code === "0x") fail("REGISTRY_NOT_FOUND");
    const value = await rpc(bscRpc, "eth_call", [
      {
        to: PAY_NETWORK.agentId,
        data: erc.encodeFunctionData("balanceOf", [address]),
      },
      block,
    ]);
    const balance = erc.decodeFunctionResult("balanceOf", value)[0];
    return {
      address: getAddress(address),
      registry: PAY_NETWORK.agentId,
      chainId: 56,
      block: Number(BigInt(block)),
      balance: balance.toString(),
      eligible: balance > 0n,
      checkedAt: new Date().toISOString(),
      authentication: false,
    };
  }
  async function destination() {
    await chain(baseRpc, 8453);
    const block = await rpc(baseRpc, "eth_blockNumber");
    const [code, d, s] = await Promise.all([
      rpc(baseRpc, "eth_getCode", [PAY_NETWORK.usdc, block]),
      rpc(baseRpc, "eth_call", [
        { to: PAY_NETWORK.usdc, data: erc.encodeFunctionData("decimals") },
        block,
      ]),
      rpc(baseRpc, "eth_call", [
        { to: PAY_NETWORK.usdc, data: erc.encodeFunctionData("symbol") },
        block,
      ]),
    ]);
    const decimals = Number(erc.decodeFunctionResult("decimals", d)[0]),
      symbol = erc.decodeFunctionResult("symbol", s)[0];
    if (code === "0x" || decimals !== 6 || symbol !== "USDC")
      fail("USDC_IDENTITY_MISMATCH");
    return {
      chainId: 8453,
      token: PAY_NETWORK.usdc,
      decimals,
      symbol,
      block: Number(BigInt(block)),
      checkedAt: new Date().toISOString(),
    };
  }
  async function quote(input) {
    const asset = SOURCE_ASSETS[input.asset];
    if (!asset) fail("UNSUPPORTED_SOURCE_ASSET");
    if (
      !isAddress(input.fromAddress) ||
      !isAddress(input.toAddress) ||
      input.fromAddress === ZeroAddress ||
      input.toAddress === ZeroAddress
    )
      fail("INVALID_ADDRESS");
    if (
      typeof input.amount !== "string" ||
      !/^\d{1,12}(\.\d{1,18})?$/.test(input.amount)
    )
      fail("INVALID_AMOUNT");
    const amount = parseUnits(input.amount, asset.decimals);
    if (amount <= 0n) fail("INVALID_AMOUNT");
    const args = new URLSearchParams({
      fromChain: "56",
      toChain: "8453",
      fromToken: asset.address,
      toToken: PAY_NETWORK.usdc,
      fromAmount: amount.toString(),
      fromAddress: getAddress(input.fromAddress),
      toAddress: getAddress(input.toAddress),
      slippage: "0.005",
      integrator: "dark-local-research",
    });
    const q = await json("https://li.quest/v1/quote?" + args);
    const a = q.action,
      e = q.estimate;
    if (
      !a ||
      a.fromChainId !== 56 ||
      a.toChainId !== 8453 ||
      a.fromToken?.address?.toLowerCase() !== asset.address.toLowerCase() ||
      a.toToken?.address?.toLowerCase() !== PAY_NETWORK.usdc.toLowerCase() ||
      a.fromAddress?.toLowerCase() !== input.fromAddress.toLowerCase() ||
      a.toAddress?.toLowerCase() !== input.toAddress.toLowerCase() ||
      a.fromAmount !== amount.toString() ||
      a.toToken?.decimals !== 6 ||
      !/^\d+$/.test(e?.toAmountMin || "") ||
      !/^\d+$/.test(e?.toAmount || "") ||
      BigInt(e.toAmountMin) <= 0n ||
      BigInt(e.toAmountMin) > BigInt(e.toAmount)
    )
      fail("QUOTE_IDENTITY_MISMATCH");
    // No transaction request or approval calldata leaves this read-only boundary.
    return {
      id: q.id,
      provider: "LI.FI",
      tool: q.tool,
      fromChain: 56,
      toChain: 8453,
      asset: input.asset,
      fromAmount: amount.toString(),
      fromAddress: getAddress(input.fromAddress),
      toAddress: getAddress(input.toAddress),
      token: PAY_NETWORK.usdc,
      decimals: 6,
      toAmount: e.toAmount,
      toAmountMin: e.toAmountMin,
      slippageBps: 50,
      gasUSD: (e.gasCosts || []).map((x) => String(x.amountUSD || "0")),
      feeUSD: (e.feeCosts || []).map((x) => String(x.amountUSD || "0")),
      executionDuration: e.executionDuration ?? null,
      fetchedAt: new Date().toISOString(),
      staleAfterMs: 30000,
      canExecute: false,
    };
  }
  return { identity, destination, quote };
}
