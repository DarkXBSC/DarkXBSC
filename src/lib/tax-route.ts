import { ZeroAddress, getAddress, isAddress } from "ethers";
export const GIFT_FACTORY = "0xFb7ccc4Fd09Da5b7016A18d51e227Af4ABE53f44";
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955";
export type TaxRoute =
  | "commission"
  | "reserve"
  | "wallet"
  | "x"
  | "binance"
  | "square";
export function payBeneficiary(
  binding: { address: string; asset: string; chainId: number; rail: string },
  quote: string,
  rail: "binance-pay" | "xmoney-tax" = "binance-pay",
  chainId = 56,
) {
  if (
    !isAddress(quote) ||
    !isAddress(binding?.asset) ||
    (rail === "binance-pay" &&
      quote.toLowerCase() !== BSC_USDT.toLowerCase()) ||
    binding.asset.toLowerCase() !== quote.toLowerCase() ||
    binding.chainId !== chainId ||
    binding.rail !== rail ||
    !isAddress(binding.address) ||
    binding.address === ZeroAddress
  )
    throw Error(
      rail === "xmoney-tax" ? "RECIPIENT_CHANGED" : "BINANCE_ROUTE_MISMATCH",
    );
  return getAddress(binding.address);
}

export type BeneficiaryDisclosure = {
  visibility: "private" | "public";
  purpose: string;
};
export type RecipientCheck = {
  sponsorFunded?: boolean;
  recipient?: {
    handle: string;
    profile: string;
    name?: string;
    avatar?: string;
  };
  disclosure?: BeneficiaryDisclosure;
  state: string;
  input: string;
  ticket?: string;
  profile?: string;
  post?: string;
  quote?: { inputUSDT: string; minimumUSDC: string; inputSymbol?: string; chainId?: number };
};
export async function checkRecipient(
  input: string,
  route: "binance" | "x" = "binance",
  nomination?: string,
  disclosure?: BeneficiaryDisclosure,
  beneficiaryKey?: string,
  chainId = 56,
): Promise<RecipientCheck> {
  try {
    const r = await fetch(
      route === "x" ? "/api/giving/x/check" : "/api/giving/recipient",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          nomination && route === "x"
            ? { nomination, disclosure, beneficiaryKey, chainId }
            : {
                recipient: input.trim(),
                ...(route === "x" ? { disclosure, beneficiaryKey, chainId } : {}),
              },
        ),
        signal: AbortSignal.timeout(20000),
      },
    );
    const data = await r.json();
    return {
      input: nomination || input,
      state: r.ok ? data.state : data.error,
      profile: data.profile,
      recipient: data.recipient,
      sponsorFunded: data.sponsorFunded,
      disclosure: data.disclosure,
      post: data.post,
      ticket: data.ticket,
      quote: data.quote,
    };
  } catch {
    return {
      input: nomination || input,
      state: route === "x" ? "X_TAX_CHECK_FAILED" : "MERCHANT_CHECK_FAILED",
    };
  }
}

export const checkBinanceRecipient = (value: string) =>
  checkRecipient(value, "binance");

export async function bindXTax(
  recipient: string,
  ticket: string | undefined,
  salt: string,
  predicted: string | null,
  quote: string,
  nomination?: string,
  disclosure?: BeneficiaryDisclosure,
  beneficiaryKey?: string,
  chainId = 56,
  pons?: { issuer: string; proof?: {to: string; data: string; value: string} },
) {
  if (!ticket) throw Error("RECIPIENT_CHANGED");
  const res = await fetch("/api/giving/x/bind", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(nomination ? { nomination } : { recipient }),
      ticket,
      quote,
      salt,
      ...pons,
      confirmed: true,
      disclosure,
      beneficiaryKey,
      chainId,
    }),
    signal: AbortSignal.timeout(20000),
  });
  const binding = await res.json();
  if (!res.ok) throw Error(binding.error);
  if (
    binding.ticket !== ticket ||
    (predicted ? !isAddress(binding.token) || binding.token.toLowerCase() !== predicted.toLowerCase() : !(chainId === 4663 && pons && !pons.proof))
  )
    throw Error("RECIPIENT_CHANGED");
  return payBeneficiary(binding, quote, "xmoney-tax", chainId);
}
