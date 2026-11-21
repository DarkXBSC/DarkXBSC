import { parentPort, workerData } from "node:worker_threads";
import { randomBytes, keccak256, getCreate2Address } from "ethers";
const { implementation, portal, suffix } = workerData;
const hash = keccak256(
  "0x3d602d80600a3d3981f3363d3d373d3d3d363d73" +
    implementation.slice(2).toLowerCase() +
    "5af43d82803e903d91602b57fd5bf3",
);
let salt = keccak256(randomBytes(32));
for (let i = 0; i < 2_000_000; i++) {
  const predicted = getCreate2Address(portal, salt, hash);
  if (predicted.toLowerCase().endsWith(suffix)) {
    parentPort.postMessage({ salt, predicted, iterations: i });
    break;
  }
  salt = keccak256(salt);
  if (i === 1_999_999) throw Error("Mining limit reached");
}
