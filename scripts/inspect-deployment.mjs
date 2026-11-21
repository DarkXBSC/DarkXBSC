import fs from "node:fs";
import { JsonRpcProvider, Contract, keccak256 } from "ethers";
import { atomic, loadEnv } from "./env.mjs";
import { networks, bscProvider } from "./config.mjs";
const { env, address } = loadEnv(),
  manifest = JSON.parse(fs.readFileSync("public/deployments.json"));
const report = {
  at: new Date().toISOString(),
  project: "tiger-genesis",
  deployer: address,
  chains: {},
};
for (const [key, c] of Object.entries(manifest.chains)) {
  if (!Object.keys(c.contracts).length) {
    report.chains[key] = {};
    continue;
  }
  const p =
    key === "bsc"
      ? await bscProvider(env)
      : new JsonRpcProvider(
          env[key.toUpperCase() + "_RPC_URL"] || networks[key].rpc,
        );
  try {
    const chainReport = {};
    for (const [module, m] of Object.entries(c.contracts)) {
      const a = JSON.parse(fs.readFileSync("artifacts/" + m.name + ".json"));
      const contract = new Contract(m.address, a.abi, p),
        code = await p.getCode(m.address),
        r = await p.getTransactionReceipt(m.transactionHash);
      let state = {};
      if (module === "registry")
        state = {
          owner: await contract.owner(),
          count: String(await contract.count()),
        };
      if (module === "settlement")
        state = {
          feeRecipient: await contract.feeRecipient(),
          feeBps: String(await contract.FEE_BPS()),
          agentRegistry: await contract.agentRegistry(),
        };
      if (module === "reserveFactory" || module === "commissionFactory")
        state = {
          version: await contract.factorySpecVersion(),
          nativeQuoteSupported: await contract.isQuoteTokenSupported(
            "0x0000000000000000000000000000000000000000",
          ),
        };
      chainReport[module] = {
        address: m.address,
        receiptSuccess: r?.status === 1,
        codeBytes: (code.length - 2) / 2,
        codeHash: keccak256(code),
        ...state,
      };
      if (!r || r.status !== 1 || code === "0x")
        throw Error("Invalid deployment");
      if (module === "registry" && state.owner !== env.CONTRACT_OWNER)
        throw Error("Owner mismatch");
      if (module === "settlement" && state.feeRecipient !== env.FEE_RECIPIENT)
        throw Error("Fee recipient mismatch");
    }
    report.chains[key] = chainReport;
  } finally {
    p.destroy();
  }
}
atomic("deployments/inspection.json", report);
console.log(JSON.stringify(report, null, 2));
