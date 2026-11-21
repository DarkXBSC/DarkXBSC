// Standalone settlement worker. It exposes no network listener or signing RPC.
import { readFileSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Wallet, verifyMessage, getAddress } from "ethers";
import dotenv from "dotenv";
import { createXTaxGiving } from "./x-tax-giving.mjs";
import { hostedLedger, signerStatus } from "./x-hosted.mjs";

const credential = (name) =>
  readFileSync(join(process.env.CREDENTIALS_DIRECTORY, name), "utf8");
const config = dotenv.parse(credential("giving.env"));
const wallet = new Wallet(credential("sponsor.key").trim());
const expected = getAddress(
  JSON.parse(readFileSync("deployments/inspection.json")).deployer,
);
if (wallet.address !== expected || config.X_TAX_GAS_SPONSOR !== "deployer")
  throw Error("X_SIGNER_MISMATCH");
const challenge =
  "Darkwork production settlement worker startup " + randomUUID();
const proof = await wallet.signMessage(challenge);
if (verifyMessage(challenge, proof) !== expected)
  throw Error("X_SIGNER_PROOF_FAILED");
const service = createXTaxGiving(config, {
  dir: hostedLedger,
  sharedLedger: true,
  gasKey: wallet.privateKey,
});
if (!service.enabled) throw Error("X_TAX_UNAVAILABLE");

function record(ready) {
  const body = { address: expected, ready, at: Date.now(), challenge, proof };
  writeFileSync(signerStatus + ".tmp", JSON.stringify(body), { mode: 0o644 });
  chmodSync(signerStatus + ".tmp", 0o644);
  renameSync(signerStatus + ".tmp", signerStatus);
}
const stop = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => stop.abort());
try {
  while (!stop.signal.aborted) {
    try {
      await service.tick();
      record(true);
    } catch {
      record(false);
    }
    await delay(15000, undefined, { signal: stop.signal }).catch(() => {});
  }
} finally {
  record(false);
  service.close();
}
