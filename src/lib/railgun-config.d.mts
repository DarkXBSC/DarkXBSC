export type RailgunChain = "bsc";
export type ShieldAsset = { symbol: string; address: string; decimals: number };
export type RailgunNetwork = {
  id: number;
  name: string;
  native: string;
  proxy: string;
  wrapped: string;
  relay: string;
  assets: ShieldAsset[];
};
export const railgunNetworks: Record<RailgunChain, RailgunNetwork>;
export function railgunNetwork(chain: string): RailgunNetwork;
export function shieldAmounts(
  amount: bigint,
  feeBps: bigint,
): { fee: bigint; receive: bigint };
export const railgunAbi: string[];
