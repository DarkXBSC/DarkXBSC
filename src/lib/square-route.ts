// The author URL is part of the wallet signature. Display names cannot bind a payout.
import { getAddress, ZeroAddress } from "ethers";
export function squareProfile(input: string) {
  const u = new URL(input);
  if (
    u.protocol !== "https:" ||
    !["binance.com", "www.binance.com"].includes(u.hostname) ||
    u.port ||
    u.username ||
    u.password
  )
    throw Error("INVALID_SQUARE_PROFILE");
  const slug = u.pathname.match(
    /^\/(?:[a-z]{2}(?:-[a-zA-Z]{2,5})?\/)?square\/profile\/([a-zA-Z0-9_-]{1,100})\/?$/,
  )?.[1];
  if (!slug) throw Error("INVALID_SQUARE_PROFILE");
  return "https://www.binance.com/en/square/profile/" + slug.toLowerCase();
}
export function squareStatement(profile: string, wallet: string) {
  const address = getAddress(wallet);
  if (address === ZeroAddress) throw Error("INVALID_ADDRESS");
  return [
    "Dark Flap tax beneficiary",
    "Network: BSC (56)",
    "Square: " + squareProfile(profile),
    "Wallet: " + address,
  ].join("\n");
}

export function squarePostId(raw: string) {
  try {
    const u = new URL(raw);
    if (
      u.protocol !== "https:" ||
      !["www.binance.com", "binance.com"].includes(u.hostname) ||
      u.username ||
      u.password ||
      u.port
    )
      return null;
    return (
      u.pathname.match(
        /^\/(?:[a-z]{2}(?:-[a-zA-Z]{2,5})?\/)?square\/post\/([1-9]\d{0,24})\/?$/,
      )?.[1] || null
    );
  } catch {
    return null;
  }
}
