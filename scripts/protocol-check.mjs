import fs from "node:fs";
import https from "node:https";
import dotenv from "dotenv";
import { Worker } from "node:worker_threads";
import {
  JsonRpcProvider,
  Contract,
  Interface,
  ZeroAddress,
  keccak256,
} from "ethers";
import { bscProvider } from "./config.mjs";
import { atomic } from "./env.mjs";
const env = dotenv.parse(
    fs.readFileSync(fs.existsSync(".env") ? ".env" : ".env.example"),
  ),
  protocol = JSON.parse(fs.readFileSync("public/protocols.json")),
  manifest = JSON.parse(fs.readFileSync("public/deployments.json"));
const address = JSON.parse(
  fs.readFileSync("deployments/inspection.json"),
).deployer;
if (!address) throw Error("A public BSC deployment address is required");
const reports = {
  at: new Date().toISOString(),
  mode: "eth_call only; no signatures, uploads or broadcasts",
  checks: [],
};
const p = await bscProvider(env);
const portal = new Contract(
  protocol.flap.portal,
  JSON.parse(fs.readFileSync("public/contracts/IPortal.abi.json")),
  p,
);
const vaultInterface = new Interface(
  JSON.parse(fs.readFileSync("public/contracts/IVaultPortal.abi.json")),
);
const salt = await new Promise((resolve, reject) => {
  const worker = new Worker(new URL("./mine-salt.mjs", import.meta.url), {
    workerData: {
      implementation: protocol.flap.taxImplementation,
      portal: protocol.flap.portal,
      suffix: "7777",
    },
  });
  worker.on("message", resolve);
  worker.on("error", reject);
});
const liveDirectory = await new Promise((resolve, reject) => {
  const request = https.get(
    "https://flap.sh/api/launch/quote-tokens",
    {
      headers: { "User-Agent": "DarkGenesis/1.0", Accept: "application/json" },
    },
    (response) => {
      let data = "";
      response.on("data", (chunk) => {
        data += chunk;
        if (data.length > 1000000)
          request.destroy(Error("Directory response too large"));
      });
      response.on("end", () => {
        try {
          if (response.statusCode !== 200)
            throw Error("Quote directory unavailable");
          resolve(JSON.parse(data));
        } catch (error) {
          reject(error);
        }
      });
    },
  );
  request.setTimeout(15000, () =>
    request.destroy(Error("Directory request timed out")),
  );
  request.on("error", reject);
});
const directory = liveDirectory.chains.find(
  (c) => c.chainId === 56,
).quoteTokens;
const assets = [
  directory.find((q) => q.address === ZeroAddress),
  directory.find((q) => q.symbol === "SPCXB"),
  directory.find((q) => q.symbol === "XAUT"),
].filter(Boolean);
for (const asset of assets) {
  const cfg = await portal.getQuoteTokenConfiguration(asset.address);
  const params = {
    name: "Dark Readonly Probe",
    symbol: "PROBE",
    meta: "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku",
    dexThresh: 1,
    salt: salt.salt,
    migratorType: 1,
    quoteToken: asset.address,
    quoteAmt: 0,
    permitData: "0x",
    extensionID: "0x" + "0".repeat(64),
    extensionData: "0x",
    dexId: Number(cfg.dexId),
    lpFeeProfile: 0,
    buyTaxRate: 100,
    sellTaxRate: 100,
    taxDuration: 31536000,
    antiFarmerDuration: 0,
    mktBps: 10000,
    deflationBps: 0,
    dividendBps: 0,
    lpBps: 0,
    minimumShareBalance: 0,
    dividendToken: asset.address,
    commissionReceiver: ZeroAddress,
    tokenVersion: 6,
    vaultFactory: manifest.chains.bsc.contracts.reserveFactory.address,
    vaultData: "0x",
  };
  try {
    const data = vaultInterface.encodeFunctionData("newTokenV6WithVault", [
        params,
      ]),
      request = {
        from: address,
        to: protocol.flap.vaultPortal,
        data,
        value: 0n,
      };
    const result = await p.call(request),
      decoded = vaultInterface.decodeFunctionResult(
        "newTokenV6WithVault",
        result,
      );
    const gas = await p.estimateGas(request);
    reports.checks.push({
      asset: asset.symbol,
      decimals: asset.decimals,
      enabled: Number(cfg.enabled),
      simulation: "passed",
      predicted: decoded[0],
      gas: gas.toString(),
      matches: decoded[0].toLowerCase() === salt.predicted.toLowerCase(),
    });
  } catch (e) {
    let decoded;
    try {
      decoded = portal.interface.parseError(e.data)?.name;
    } catch {}
    reports.checks.push({
      asset: asset.symbol,
      enabled: Number(cfg.enabled),
      simulation: "reverted",
      selector: e.data?.slice(0, 10),
      error: decoded || e.code,
      reason: e.reason || null,
    });
  }
}
await p.destroy();
if (!process.argv.includes("--bsc-only")) {
  const rh = new JsonRpcProvider(env.ROBINHOOD_RPC_URL);
  try {
    const c = new Contract(
      protocol.pons.factory,
      [
        "function canLaunch(address) view returns(bool)",
        "function launchFee() view returns(uint256)",
        "function launchConfigCount() view returns(uint256)",
      ],
      rh,
    );
    reports.pons = {
      factory: protocol.pons.factory,
      codeBytes: ((await rh.getCode(protocol.pons.factory)).length - 2) / 2,
      canLaunch: await c.canLaunch(address),
      launchFee: String(await c.launchFee()),
      configCount: String(await c.launchConfigCount()),
    };
  } finally {
    rh.destroy();
  }
}
atomic("work/protocol-check.json", reports);
console.log(JSON.stringify(reports, null, 2));
