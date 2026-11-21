import { ZeroAddress, getAddress, isAddress } from "ethers";
export const GIFT_FACTORY = "0xFb7ccc4Fd09Da5b7016A18d51e227Af4ABE53f44";
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
) {
  if (
    !isAddress(quote) ||
    !isAddress(binding?.asset) ||
    (rail === "binance-pay" &&
      quote.toLowerCase() !== BSC_USDT.toLowerCase()) ||
    binding.asset.toLowerCase() !== quote.toLowerCase() ||
    binding.chainId !== 56 ||
    binding.rail !== rail ||
    !isAddress(binding.address) ||
    binding.address === ZeroAddress
  )
    throw Error(
      rail === "xmoney-tax" ? "RECIPIENT_CHANGED" : "BINANCE_ROUTE_MISMATCH",
    );
  return getAddress(binding.address);
}

export type RecipientCheck = {
  state: string;
  input: string;
  ticket?: string;
  profile?: string;
  post?: string;
  quote?: { inputUSDT: string; minimumUSDC: string };
};
export async function checkRecipient(
  input: string,
  route: "binance" | "x" = "binance",
  nomination?: string,
): Promise<RecipientCheck> {
  try {
    const r = await fetch(
      route === "x" ? "/api/giving/x/check" : "/api/giving/recipient",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          nomination && route === "x"
            ? { nomination }
            : { recipient: input.trim() },
        ),
        signal: AbortSignal.timeout(20000),
      },
    );
    const data = await r.json();
    return {
      input: nomination || input,
      state: r.ok ? data.state : data.error,
      profile: data.profile,
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
  predicted: string,
  quote: string,
  nomination?: string,
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
      confirmed: true,
    }),
    signal: AbortSignal.timeout(20000),
  });
  const binding = await res.json();
  if (!res.ok) throw Error(binding.error);
  if (
    binding.ticket !== ticket ||
    !isAddress(binding.token) ||
    binding.token.toLowerCase() !== predicted.toLowerCase()
  )
    throw Error("RECIPIENT_CHANGED");
  return payBeneficiary(binding, quote, "xmoney-tax");
}
