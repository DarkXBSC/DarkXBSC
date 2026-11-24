import type { RailgunChain } from "./railgun-config.mjs";
export function validateRailgunAddress(
  address: string,
  chain: RailgunChain,
): unknown;
export function createShieldCall(input: {
  chain: RailgunChain;
  address: string;
  token: string;
  amount: string;
  native?: boolean;
}): Promise<{ to: string; data: string; value: string; npk: string }>;
