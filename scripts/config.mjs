import { FetchRequest, JsonRpcProvider } from "ethers";
export const networks = {
  bsc: {
    id: 56,
    name: "BNB Smart Chain",
    symbol: "BNB",
    rpc: "https://bsc-dataseed.bnbchain.org",
    explorer: "https://bscscan.com",
    agentRegistry: "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F",
  },
  robinhood: {
    id: 4663,
    name: "Robinhood Chain",
    symbol: "ETH",
    rpc: "https://rpc.mainnet.chain.robinhood.com",
    explorer: "https://robinhoodchain.blockscout.com",
    agentRegistry: "0x0000000000000000000000000000000000000000",
  },
};
export const modules = [
  ["registry", "TigerRegistry"],
  ["settlement", "TigerSettlement"],
  ["inventory", "TigerInventory"],
  ["reserveFactory", "TigerReserveFactory"],
];
export function argsFor(name, env, network) {
  return name === "TigerRegistry"
    ? [env.CONTRACT_OWNER]
    : name === "TigerSettlement"
      ? [env.FEE_RECIPIENT, network.agentRegistry]
      : [];
}

/** Select a responsive BSC endpoint before a deployment or read-only check. */
export async function bscProvider(env) {
  const endpoints = new Set(
    [
      env.BSC_RPC_URL,
      env.X_TAX_BSC_RPC_URL,
      "https://bsc-rpc.publicnode.com",
      "https://1rpc.io/bnb",
    ].filter(Boolean),
  );
  for (const url of endpoints) {
    const req = new FetchRequest(url);
    req.timeout = 12000;
    const provider = new JsonRpcProvider(req, 56, { staticNetwork: true });
    try {
      if (BigInt(await provider.send("eth_chainId", [])) === 56n)
        return provider;
    } catch {
      // Try the next configured endpoint before signing.
    }
    provider.destroy();
  }
  throw Error("RPC chain 56 unavailable");
}
