// Credential-free integrations used by the local X Money settlement service.
import { Interface, ZeroAddress, getAddress } from "ethers";
import { nearIntentsQuoteFromJson, nearIntentsQuoteToJson } from "@zkp2p/cash";
import { verifyQuoteSignature } from "@defuse-protocol/one-click-sdk-typescript";
import { BSC_USDT } from "./binance-giving.mjs";
import { USDC } from "./peer-pay.mjs";

export const FX_API = "https://api.fxtwitter.com";
export const ONE_CLICK_API = "https://1click.chaindefuser.com";
const SOURCE = "nep141:bnb-" + BSC_USDT.toLowerCase() + ".omdep.near";
const DEST = "nep141:base-" + USDC.toLowerCase() + ".omft.near";
const erc20 = new Interface([
  "function transfer(address recipient,uint256 amount) returns(bool)",
]);
export async function publicXIdentity(handle, fetcher = fetch) {
  if (!/^[a-z0-9_]{1,15}$/.test(handle)) throw Error("INVALID_X_HANDLE");
  const response = await fetcher(FX_API + "/2/profile/" + handle, {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 404) throw Error("X_ACCOUNT_UNVERIFIED");
  if (!response.ok) throw Error("X_LOOKUP_UNAVAILABLE");
  const data = await response.json();
  if (data.code !== 200 && data.code !== 404)
    throw Error("X_LOOKUP_UNAVAILABLE");
  if (
    data.code === 404 ||
    data.user?.screen_name?.toLowerCase() !== handle ||
    typeof data.user?.id !== "string" ||
    !/^[1-9]\d{0,23}$/.test(data.user.id)
  )
    throw Error("X_ACCOUNT_UNVERIFIED");
  return data.user.id;
}
export async function nearQuote(
  cash,
  address,
  amount,
  dry = true,
  now = Date.now(),
) {
  address = getAddress(address);
  const q = await cash.quoteNearIntentsSource({
    sourceAsset: SOURCE,
    amount,
    recipient: address,
    refundTo: address,
    tradeType: "EXACT_INPUT",
    deadline: new Date(now + 20 * 60 * 1000).toISOString(),
    slippageTolerance: 50,
    dry,
  });
  if (
    !verifyQuoteSignature(q.raw) ||
    q.sourceAsset !== SOURCE ||
    q.destinationAsset !== DEST ||
    q.inputAmount !== amount ||
    q.request.swapType !== "EXACT_INPUT" ||
    q.request.dry !== dry ||
    getAddress(q.request.recipient) !== address ||
    getAddress(q.request.refundTo) !== address ||
    q.raw.quoteRequest.recipientType !== "DESTINATION_CHAIN" ||
    q.raw.quoteRequest.refundType !== "ORIGIN_CHAIN" ||
    q.raw.quoteRequest.depositType !== "ORIGIN_CHAIN" ||
    q.raw.quoteRequest.depositMode !== "SIMPLE" ||
    q.depositMemo ||
    !q.correlationId ||
    q.minOutputAmount <= 0n ||
    q.minOutputAmount > q.outputAmount ||
    q.minOutputAmount * 10n ** 12n * 100n < amount * 98n
  )
    throw Error("X_QUOTE_UNAVAILABLE");
  if (
    !dry &&
    (!q.depositAddress ||
      getAddress(q.depositAddress) === ZeroAddress ||
      getAddress(q.depositAddress) === address ||
      !Number.isFinite(Date.parse(q.deadline)) ||
      nearDepositDeadline(q) < now + 90_000)
  )
    throw Error("X_QUOTE_UNAVAILABLE");
  return {
    requestId: "near:" + q.correlationId,
    inputAmount: amount,
    outputAmount: q.minOutputAmount,
    source: { chainId: 56, address: BSC_USDT },
    destination: { chainId: 8453, address: USDC },
    near: nearIntentsQuoteToJson(q),
  };
}
// The provider can keep a deposit address active beyond our own execution window.
export function nearDepositDeadline(q) {
  return Math.min(
    Date.parse(q.raw.quoteRequest.deadline),
    Date.parse(q.raw.quote.deadline),
  );
}
export async function signNearDeposit(
  quote,
  signer,
  populate = (tx) => signer.populateTransaction(tx),
) {
  const q = nearIntentsQuoteFromJson(quote.near);
  if (
    q.request.dry ||
    !q.depositAddress ||
    getAddress(q.request.refundTo) !== signer.address ||
    getAddress(q.request.recipient) !== signer.address ||
    q.raw.quoteRequest.dry !== false ||
    q.raw.quoteRequest.originAsset !== SOURCE ||
    q.raw.quoteRequest.destinationAsset !== DEST ||
    getAddress(q.raw.quoteRequest.recipient) !== signer.address ||
    getAddress(q.raw.quoteRequest.refundTo) !== signer.address ||
    getAddress(q.depositAddress) !== getAddress(q.raw.quote.depositAddress) ||
    q.inputAmount !== BigInt(q.raw.quote.amountIn) ||
    !Number.isFinite(nearDepositDeadline(q)) ||
    nearDepositDeadline(q) <= Date.now() + 60_000 ||
    !verifyQuoteSignature(q.raw)
  )
    throw Error("X_QUOTE_UNAVAILABLE");
  const tx = await populate({
    to: BSC_USDT,
    value: 0n,
    data: erc20.encodeFunctionData("transfer", [
      q.depositAddress,
      q.inputAmount,
    ]),
  });
  if (tx.chainId !== 56n) throw Error("X_CHAIN_MISMATCH");
  return signer.signTransaction(tx);
}
export async function nearStatus(cash, evidence) {
  const q = nearIntentsQuoteFromJson(evidence.near);
  const result = await cash.nearIntentsStatus({
    depositAddress: q.depositAddress,
    expectedQuote: q,
  });
  if (!verifyQuoteSignature(result.raw.quoteResponse))
    throw Error("X_BRIDGE_REVIEW");
  const state =
    result.status === "SUCCESS"
      ? "success"
      : ["REFUNDED", "INCOMPLETE_DEPOSIT", "FAILED"].includes(result.status)
        ? "failure"
        : "waiting";
  const origin = result.originTransactions.map((t) => t.hash);
  if (
    state === "success" &&
    (result.inputAmount !== q.inputAmount ||
      typeof result.outputAmount !== "bigint" ||
      result.outputAmount < q.minOutputAmount ||
      result.raw.quoteResponse.signature !== q.raw.signature ||
      (origin.length &&
        !origin.some((h) => h.toLowerCase() === evidence.hash.toLowerCase())))
  )
    throw Error("X_BRIDGE_REVIEW");
  return {
    requestId: "near:" + q.correlationId,
    status: state,
    originChainId: 56,
    destinationChainId: 8453,
    settledAmount: result.outputAmount,
    inTxHashes: [evidence.hash],
    txHashes: result.destinationTransactions.map((t) => t.hash),
  };
}
