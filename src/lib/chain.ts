import {
  Interface,
  Contract,
  JsonRpcProvider,
  FetchRequest,
  formatUnits,
  getAddress,
  parseUnits,
  isAddress,
  ZeroAddress,
} from "ethers";
export type Chain = "bsc" | "base" | "robinhood";
export type LaunchChain = "bsc" | "base";
export type FlapProtocol = { portal: string; vaultPortal: string; taxImplementation: string; standardImplementation?: string; agentRegistry?: string };
export function flapFor(config: Config, chain: LaunchChain) { return config.protocols.flapChains[chain]; }
export type Deployment = {
  name: string;
  address: string;
  transactionHash: string;
  block: number;
  verified: boolean;
  verificationUrl?: string;
  verificationApi?: string;
};
export type Config = {
  project: string;
  officialToken: {
    chainId: 56;
    address: string;
    name: string;
    symbol: string;
    decimals: number;
  } | null;
  chains: Record<
    Chain,
    {
      chainId: number;
      name: string;
      symbol: string;
      rpc: string;
      explorer: string;
      contracts: Record<string, Deployment>;
      history?: Record<string, Deployment[]>;
    }
  >;
  protocols: {
    flapChains: Record<LaunchChain, FlapProtocol>;
    flap: {
      portal: string;
      vaultPortal: string;
      taxImplementation: string;
      standardImplementation: string;
      agentRegistry: string;
    };
    pons: { factory: string; launchAndBuy: string; version: string };
  };
};
export const chainInfo = {
  base: { id: 8453, name: "Base", symbol: "ETH", explorer: "https://basescan.org" },
  bsc: {
    id: 56,
    name: "BNB Smart Chain",
    symbol: "BNB",
    explorer: "https://bscscan.com",
  },
  robinhood: {
    id: 4663,
    name: "Robinhood Chain",
    symbol: "ETH",
    explorer: "https://robinhoodchain.blockscout.com",
  },
};
const providers = new Map<Chain, JsonRpcProvider>(),
  abis = new Map<string, Promise<any[]>>();
export function rpc(chain: Chain) {
  let p = providers.get(chain);
  if (!p) {
    const req = new FetchRequest(location.origin + "/api/rpc/" + chain);
    req.timeout = 20000;
    p = new JsonRpcProvider(req, chainInfo[chain].id, {
      staticNetwork: true,
      batchMaxCount: 10,
      cacheTimeout: 250,
    });
    providers.set(chain, p);
  }
  return p;
}
export function abi(name: string) {
  if (!abis.has(name))
    abis.set(
      name,
      fetch("/contracts/" + name + ".abi.json").then((r) => {
        if (!r.ok) throw Error("ABI_UNAVAILABLE");
        return r.json();
      }),
    );
  return abis.get(name)!;
}
export const erc20 = [
  "function name() view returns(string)",
  "function symbol() view returns(string)",
  "function decimals() view returns(uint8)",
  "function totalSupply() view returns(uint256)",
  "function balanceOf(address) view returns(uint256)",
  "function allowance(address,address) view returns(uint256)",
  "function approve(address,uint256) returns(bool)",
];
export async function asset(chain: Chain, address: string) {
  if (!isAddress(address)) throw Error("INVALID_ADDRESS");
  const c = new Contract(address, erc20, rpc(chain));
  const [name, symbol, decimals, supply] = await Promise.all([
    c.name(),
    c.symbol(),
    c.decimals(),
    c.totalSupply(),
  ]);
  if (Number(decimals) > 36) throw Error("UNSUPPORTED_DECIMALS");
  return {
    address: getAddress(address),
    name: String(name),
    symbol: String(symbol),
    decimals: Number(decimals),
    supply: formatUnits(supply, decimals),
  };
}
export function units(s: string, decimals: number) {
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(s)) throw Error("INVALID_AMOUNT");
  try {
    return parseUnits(s, decimals);
  } catch {
    throw Error("INVALID_AMOUNT");
  }
}
export function publicUrl(value: string) {
  if (value.startsWith("ipfs://"))
    return (
      "https://flap.mypinata.cloud/ipfs/" +
      value.slice(7).replace(/^ipfs\//, "")
    );
  try {
    const u = new URL(value);
    return u.protocol === "https:" ? u.href : "";
  } catch {
    return "";
  }
}
export function short(value: string) {
  return value.length > 18 ? value.slice(0, 8) + "…" + value.slice(-6) : value;
}
export function errorCode(e: any) {
  if (e?.code === "ACTION_REJECTED" || e?.code === 4001) return "REJECTED";
  if (e?.code === "INSUFFICIENT_FUNDS") return "INSUFFICIENT_FUNDS";
  if (e?.code === "CALL_EXCEPTION") return "CALL_REVERTED";
  if (e?.message && /^[A-Z_]+$/.test(e.message)) return e.message;
  return "REQUEST_FAILED";
}
export { ZeroAddress, formatUnits, parseUnits, Contract };

export async function approveExact(
  chain: Chain,
  token: string,
  spender: string,
  amount: bigint,
  send: (chain: Chain, tx: any, label: string) => Promise<any>,
  label: string,
) {
  if (amount <= 0n) throw Error("INVALID_AMOUNT");
  const accounts = await window.ethereum?.request({ method: "eth_accounts" });
  if (!accounts?.[0]) throw Error("CONNECT_WALLET");
  const c = new Contract(token, erc20, rpc(chain)),
    existing = await c.allowance(getAddress(accounts[0]), spender);
  if (existing >= amount) return;
  const i = new Interface(erc20);
  if (existing > 0n)
    await send(
      chain,
      { to: token, data: i.encodeFunctionData("approve", [spender, 0n]) },
      label + " / reset",
    );
  await send(
    chain,
    { to: token, data: i.encodeFunctionData("approve", [spender, amount]) },
    label,
  );
}
