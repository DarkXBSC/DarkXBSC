import { readFileSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";
import dotenv from "dotenv";
import { createXTaxGiving } from "./x-tax-giving.mjs";

const key = dotenv.parse(readFileSync(".env")).DEPLOYER_PRIVATE_KEY;
if (!key) throw Error("X_GAS_SPONSOR_MISSING");
const service = createXTaxGiving(workerData, { gasKey: key });
if (!service.enabled) throw Error("X_TAX_UNAVAILABLE");

async function run() {
  try {
    await service.tick();
    parentPort.postMessage(true);
  } catch {
    parentPort.postMessage(false);
  }
  setTimeout(run, 15000);
}
await run();
