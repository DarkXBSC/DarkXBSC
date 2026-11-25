export type PublicBatch = {
  seq: number;
  stage: string;
  hash: string | null;
  net: string | null;
  fee: string | null;
  gross: string;
  block: number | null;
};
export type GivingLedgerData = {
  rail: string;
  chainId: number;
  token: string;
  collector: string;
  share: number;
  creation: string | null;
  lastBlock: number;
  received: string;
  available: string;
  threshold: string;
  shortfall: string;
  shielded: string;
  issue: string;
  stage: string;
  batches: PublicBatch[];
  conversion?: {
    earned: string;
    remaining: string;
    last?: { hash: string; actual: string; stage: string };
  } | null;
};
export function firstReceipt(
  ledger: GivingLedgerData,
  token: string,
): (PublicBatch & { hash: string; net: string; block: number }) | null;
export function receiptPaths(address: string): { chart: string; image: string };
