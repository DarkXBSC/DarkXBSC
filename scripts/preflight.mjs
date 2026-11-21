import fs from "node:fs";
import {
  JsonRpcProvider,
  formatEther,
  parseEther,
  getCreateAddress,
  keccak256,
} from "ethers";
import { loadEnv, atomic } from "./env.mjs";
import { networks } from "./config.mjs";
async function main() {
  const { env, address } = loadEnv();
  const result = {
    project: "tiger-genesis",
    at: new Date().toISOString(),
    deployer: address,
    owner: env.CONTRACT_OWNER,
    feeRecipient: env.FEE_RECIPIENT,
    chains: {},
  };
  for (const [key, n] of Object.entries(networks)) {
    const p = new JsonRpcProvider(env[key.toUpperCase() + "_RPC_URL"] || n.rpc);
    try {
      const [net, balance, fees, nonce, code] = await Promise.all([
        p.getNetwork(),
        p.getBalance(address),
        p.getFeeData(),
        p.getTransactionCount(address, "pending"),
        n.agentRegistry.endsWith("0000000000")
          ? "0x"
          : p.getCode(n.agentRegistry),
      ]);
      result.chains[key] = {
        chainId: Number(net.chainId),
        chainMatches: Number(net.chainId) === n.id,
        balance: formatEther(balance),
        gasPrice: fees.gasPrice?.toString(),
        nonce,
        budget: env["MAX_DEPLOY_COST_" + key.toUpperCase()] || null,
        agentRegistryCodeHash: code === "0x" ? null : keccak256(code),
      };
    } catch {
      result.chains[key] = { error: "RPC_READ_FAILED" };
    } finally {
      p.destroy();
    }
  }
  atomic("work/preflight.json", result);
  console.log(JSON.stringify(result, null, 2));
}
main().catch(() => {
  console.error(
    "Preflight failed. Check local environment; no secrets logged.",
  );
  process.exitCode = 1;
});
