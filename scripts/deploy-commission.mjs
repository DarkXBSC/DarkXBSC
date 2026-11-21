// Installs only the deterministic commission factory. No token or payout is created.
import fs from "node:fs";
import {
  Wallet,
  Transaction,
  formatEther,
  parseEther,
  getCreate2Address,
  keccak256,
} from "ethers";
import { bscProvider } from "./config.mjs";
import { atomic, loadEnv } from "./env.mjs";
const { env, address } = loadEnv(),
  p = await bscProvider(env);
const meta = JSON.parse(fs.readFileSync("public/contracts/commission.json"));
const capArg = process.argv
    .find((x) => x.startsWith("--max-bnb="))
    ?.split("=")[1],
  execute = process.argv.includes("--broadcast");
const journal = "deployments/private/commission-factory.json";
try {
  if (
    (await p.send("eth_chainId", [])) !== "0x38" ||
    keccak256(await p.getCode(meta.deployer)) !== meta.deployerHash ||
    getCreate2Address(meta.deployer, meta.salt, keccak256(meta.init)) !==
      meta.address
  )
    throw Error("Deployment network or proxy mismatch");
  const data = meta.salt + meta.init.slice(2);
  let record = fs.existsSync(journal)
    ? JSON.parse(fs.readFileSync(journal))
    : null;
  const existing = await p.getCode(meta.address);
  if (existing !== "0x" && keccak256(existing) !== meta.runtimeHash)
    throw Error("Factory code mismatch");
  if (existing === "0x" && !record) {
    const gas = await p.estimateGas({ from: address, to: meta.deployer, data }),
      gasLimit = (gas * 120n + 99n) / 100n,
      gasPrice = ((await p.getFeeData()).gasPrice * 115n) / 100n;
    console.log("Gas upper bound", formatEther(gasPrice * gasLimit), "BNB");
    if (!execute) process.exit(0);
    if (!capArg || gasPrice * gasLimit > parseEther(capArg))
      throw Error("Deployment fee exceeds approved budget");
    const pending = await p.getTransactionCount(address, "pending");
    if (pending !== (await p.getTransactionCount(address, "latest")))
      throw Error("Another transaction is pending for this signer");
    const signed = await new Wallet(env.DEPLOYER_PRIVATE_KEY).signTransaction({
      chainId: 56,
      type: 0,
      nonce: pending,
      to: meta.deployer,
      value: 0,
      data,
      gasPrice,
      gasLimit,
    });
    record = { address: meta.address, hash: keccak256(signed), signed };
    atomic(journal, record, true);
  }
  if (!record)
    throw Error("Existing factory requires a verified creation receipt");
  const tx = Transaction.from(record.signed);
  if (
    record.hash !== tx.hash ||
    tx.from !== address ||
    tx.chainId !== 56n ||
    tx.to?.toLowerCase() !== meta.deployer.toLowerCase() ||
    tx.value !== 0n ||
    tx.data !== data ||
    !capArg ||
    tx.gasPrice * tx.gasLimit > parseEther(capArg)
  )
    throw Error("Journal or budget mismatch");
  let receipt = await p.getTransactionReceipt(record.hash).catch(() => null);
  if (!receipt && execute) {
    if (existing === "0x") {
      try {
        await p.broadcastTransaction(record.signed);
      } catch (e) {
        if (
          !/already known|nonce too low/i.test(
            e.shortMessage + " " + (e.error?.message || ""),
          )
        )
          throw Error("Broadcast unavailable: " + (e.shortMessage || e.code));
      }
    }
    console.log("Factory transaction", record.hash);
    receipt = await p.waitForTransaction(record.hash, 6, 120000);
  }
  if (
    !receipt ||
    receipt.status !== 1 ||
    keccak256(await p.getCode(meta.address)) !== meta.runtimeHash
  )
    throw Error("Factory receipt not confirmed");
  const manifest = JSON.parse(fs.readFileSync("public/deployments.json")),
    prior = manifest.chains.bsc.contracts.commissionFactory;
  manifest.chains.bsc.contracts.commissionFactory = {
    ...prior,
    name: "TigerCommissionFactory",
    address: meta.address,
    transactionHash: receipt.hash,
    block: receipt.blockNumber,
    verified: prior?.address === meta.address && !!prior.verified,
  };
  atomic("public/deployments.json", manifest);
  console.log(
    "Factory",
    meta.address,
    "receipt",
    receipt.hash,
    "actual fee",
    formatEther(receipt.fee),
    "BNB",
  );
} finally {
  p.destroy();
}
