import { formatUnits, parseUnits } from "ethers";

export const PAY_NETWORK = {
  sourceChain: 56,
  destinationChain: 8453,
  agentId: "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F",
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  decimals: 6,
} as const;

export type PayPlanInput = {
  received: string;
  reserve: string;
  impactPercent: string;
  creators: string;
  perPersonCap: string;
};

export function planPayments(input: PayPlanInput) {
  const money = (value: string) => {
    if (!/^\d{1,12}(\.\d{1,6})?$/.test(value)) throw Error("INVALID_USDC");
    return parseUnits(value, 6);
  };
  const received = money(input.received),
    reserve = money(input.reserve),
    cap = money(input.perPersonCap);
  if (received <= 0n || reserve >= received || cap <= 0n)
    throw Error("INVALID_BUDGET");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(input.impactPercent))
    throw Error("INVALID_SHARE");
  const impactBps = parseUnits(input.impactPercent, 2);
  if (impactBps > 10000n) throw Error("INVALID_SHARE");
  if (!/^[1-9]\d{0,4}$/.test(input.creators))
    throw Error("INVALID_RECIPIENT_COUNT");
  const count = BigInt(input.creators),
    usable = received - reserve,
    impact = (usable * impactBps) / 10000n,
    creatorBudget = usable - impact,
    equal = creatorBudget / count,
    each = equal < cap ? equal : cap,
    creatorTotal = each * count,
    carry = creatorBudget - creatorTotal;
  const raw = {
    received,
    reserve,
    impact,
    creatorBudget,
    each,
    creatorTotal,
    carry,
  };
  return {
    status: "draft-not-funded" as const,
    chainId: PAY_NETWORK.destinationChain,
    token: PAY_NETWORK.usdc,
    recipients: Number(count),
    units: Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k, v.toString()]),
    ) as Record<keyof typeof raw, string>,
    display: Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k, formatUnits(v, 6)]),
    ) as Record<keyof typeof raw, string>,
    delivery: "push-after-recipient-resolution" as const,
    canExecute: false,
  };
}
