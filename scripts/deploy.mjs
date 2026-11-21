import fs from "node:fs";
import {
  Wallet,
  Transaction,
  ContractFactory,
  formatEther,
  parseEther,
  getCreateAddress,
  keccak256,
  Contract,
} from "ethers";
import { loadEnv, atomic } from "./env.mjs";
import { networks, modules, argsFor, bscProvider } from "./config.mjs";
function publishRecord(chain, module, record) {
  const previous = chain.contracts[module];
  if (previous?.address === record.address) return;
  if (previous) {
    chain.history ??= {};
    (chain.history[module] ??= []).push(previous);
  }
  chain.contracts[module] = {
    name: record.name,
    address: record.address,
    transactionHash: record.hash,
    block: record.block,
    verified: false,
  };
}
async function main() {
  const { env, address } = loadEnv(),
    broadcast = process.argv.includes("--broadcast");
  const selected =
    process.argv.find((a) => a.startsWith("--chain="))?.split("=")[1] || "bsc";
  if (selected !== "bsc") throw Error("Only BSC deployment is enabled");
  if (selected && !networks[selected]) throw Error("Unknown chain");
  const build = JSON.parse(fs.readFileSync("artifacts/build.json"));
  const journalPath = "deployments/private/genesis-journal.json";
  const journal = fs.existsSync(journalPath)
    ? JSON.parse(fs.readFileSync(journalPath))
    : {
        project: "tiger-genesis",
        deployer: address,
        owner: env.CONTRACT_OWNER,
        feeRecipient: env.FEE_RECIPIENT,
        inputHash: build.inputHash,
        chains: {},
      };
  const replaceReserve = process.argv.includes("--replace-reserve");
  const changedBuild = journal.inputHash !== build.inputHash;
  if (
    journal.project !== "tiger-genesis" ||
    journal.deployer !== address ||
    journal.owner !== env.CONTRACT_OWNER ||
    journal.feeRecipient !== env.FEE_RECIPIENT ||
    (changedBuild && !replaceReserve)
  )
    throw Error(
      "Deployment identity or compiled input changed; reconcile before continuing",
    );
  const manifest = fs.existsSync("public/deployments.json")
    ? JSON.parse(fs.readFileSync("public/deployments.json"))
    : {
        project: "tiger-genesis",
        generation: "2026-11-18",
        officialToken: null,
        chains: Object.fromEntries(
          Object.entries(networks).map(([k, n]) => [
            k,
            {
              chainId: n.id,
              name: n.name,
              symbol: n.symbol,
              rpc: n.rpc,
              explorer: n.explorer,
              contracts: {},
            },
          ]),
        ),
      };
  // A revision can replace only the factory. Preserve the original spend and
  // signed receipts, and refuse a change in any other deployment's initcode.
  if (changedBuild) {
    const cs = journal.chains.bsc;
    const prior = cs?.modules.reserveFactory;
    if (
      !prior ||
      prior.status !== "confirmed" ||
      prior.address !== manifest.chains.bsc.contracts.reserveFactory?.address
    ) {
      throw Error("Deployment identity mismatch for the active factory");
    }
    for (const [key, name] of modules) {
      const a = JSON.parse(fs.readFileSync("artifacts/" + name + ".json"));
      const request = await new ContractFactory(
        a.abi,
        a.evm.bytecode.object,
      ).getDeployTransaction(...argsFor(name, env, networks.bsc));
      const same = cs.modules[key]?.bytecodeHash === keccak256(request.data);
      if (
        cs.modules[key]?.status !== "confirmed" ||
        same === (key === "reserveFactory")
      ) {
        throw Error(
          "Prepared bytecode change does not match the factory-only revision",
        );
      }
    }
    cs.history ??= [];
    cs.history.push({
      module: "reserveFactory",
      inputHash: journal.inputHash,
      ...prior,
    });
    delete cs.modules.reserveFactory;
    journal.inputHash = build.inputHash;
  }
  const plan = {
    project: "tiger-genesis",
    createdAt: new Date().toISOString(),
    inputHash: build.inputHash,
    compiler: build.compiler,
    deployer: address,
    owner: env.CONTRACT_OWNER,
    feeRecipient: env.FEE_RECIPIENT,
    chains: {},
  };
  for (const [key, n] of Object.entries(networks)) {
    if (selected && selected !== key) continue;
    const p = await bscProvider(env);
    try {
      if (Number((await p.getNetwork()).chainId) !== n.id)
        throw Error("RPC chain mismatch");
      const balance = await p.getBalance(address),
        fee = await p.getFeeData();
      if (!fee.gasPrice) throw Error("Gas price unavailable");
      const gasPrice = (fee.gasPrice * 125n) / 100n;
      const cap = env["MAX_DEPLOY_COST_" + key.toUpperCase()]
        ? parseEther(env["MAX_DEPLOY_COST_" + key.toUpperCase()])
        : 0n;
      if (broadcast && cap <= 0n)
        throw Error("Set a total deployment budget for " + key);
      journal.chains[key] ??= { spent: "0", modules: {} };
      const cs = journal.chains[key];
      let nonce = await p.getTransactionCount(address, "pending"),
        total = 0n;
      const entries = [];
      for (const [module, name] of modules) {
        if (key === "robinhood" && module === "reserveFactory") continue;
        const a = JSON.parse(fs.readFileSync("artifacts/" + name + ".json")),
          args = argsFor(name, env, n);
        const request = await new ContractFactory(
          a.abi,
          a.evm.bytecode.object,
        ).getDeployTransaction(...args);
        const bytecodeHash = keccak256(request.data);
        let record = cs.modules[module];
        if (record && record.bytecodeHash !== bytecodeHash)
          throw Error("Prepared bytecode changed");
        if (record?.status === "confirmed") {
          if ((await p.getCode(record.address)) === "0x")
            throw Error("Confirmed contract missing");
          if (broadcast) publishRecord(manifest.chains[key], module, record);
          continue;
        }
        let estimate;
        try {
          estimate = await p.estimateGas({ ...request, from: address });
        } catch {
          if (balance !== 0n)
            throw Error("Deployment simulation failed: " + key + "/" + name);
          estimate = BigInt(
            await p.send("eth_estimateGas", [
              { from: address, data: request.data },
              "latest",
              { [address]: { balance: "0x56bc75e2d63100000" } },
            ]),
          );
        }
        const saved = record?.signed ? Transaction.from(record.signed) : null;
        const orderNonce = saved?.nonce ?? nonce;
        const gasLimit = saved?.gasLimit ?? (estimate * 120n) / 100n;
        const orderPrice = saved?.gasPrice ?? gasPrice;
        const cost = gasLimit * orderPrice;
        if (
          saved &&
          (saved.hash !== record.hash ||
            saved.from !== address ||
            saved.chainId !== BigInt(n.id) ||
            saved.to !== null ||
            saved.value !== 0n ||
            keccak256(saved.data) !== bytecodeHash ||
            cost !== BigInt(record.maximumCost))
        ) {
          throw Error("Saved transaction identity mismatch");
        }
        total += cost;
        entries.push({
          module,
          name,
          args,
          estimatedGas: estimate.toString(),
          gasLimit: gasLimit.toString(),
          gasPrice: orderPrice.toString(),
          maximumCost: formatEther(cost),
          predictedAddress: getCreateAddress({
            from: address,
            nonce: orderNonce,
          }),
          nonce: orderNonce,
          bytecodeHash,
        });
        if (broadcast) {
          if (BigInt(cs.spent) + cost > cap)
            throw Error("Deployment budget would be exceeded");
          if (!record) {
            if ((await p.getBalance(address)) < cost)
              throw Error("Insufficient gas balance on " + key);
            const wallet = new Wallet(env.DEPLOYER_PRIVATE_KEY);
            const signed = await wallet.signTransaction({
              ...request,
              nonce,
              gasLimit,
              gasPrice,
              type: 0,
              chainId: n.id,
            });
            record = {
              name,
              args,
              bytecodeHash,
              status: "prepared",
              signed,
              hash: keccak256(signed),
              nonce,
              maximumCost: cost.toString(),
            };
            cs.modules[module] = record;
            atomic(journalPath, journal, true);
          }
          if (record.status === "failed")
            throw Error("Saved transaction failed; reconcile first");
          // Some public endpoints reject lookups for unknown hashes as archive
          // requests. An unused nonce can safely replay the identical signed bytes.
          let receipt;
          if (
            (await p.getTransactionCount(address, "latest")) <= record.nonce
          ) {
            try {
              const hash = await p.send("eth_sendRawTransaction", [
                record.signed,
              ]);
              if (hash !== record.hash)
                throw Error("Saved transaction hash mismatch");
            } catch (error) {
              if (
                !/already known|already imported|known transaction|nonce too low/i.test(
                  error.error?.message || "",
                )
              )
                throw error;
            }
            record.status = "pending";
            atomic(journalPath, journal, true);
            receipt = await p.waitForTransaction(record.hash, 2, 120000);
          } else {
            receipt = await p.getTransactionReceipt(record.hash);
            if (!receipt) throw Error("Saved nonce consumed; reconcile first");
          }
          if (!receipt)
            throw Error("Pending transaction retained for recovery");
          if ((await receipt.confirmations()) < 2)
            receipt = await p.waitForTransaction(record.hash, 2, 120000);
          if (!receipt || receipt.status !== 1 || !receipt.contractAddress) {
            record.status = "failed";
            atomic(journalPath, journal, true);
            throw Error("Deployment failed");
          }
          if (
            receipt.contractAddress !==
            getCreateAddress({ from: address, nonce: record.nonce })
          ) {
            throw Error("Saved transaction deployment address mismatch");
          }
          record.status = "confirmed";
          record.address = receipt.contractAddress;
          record.block = receipt.blockNumber;
          record.actualCost = (receipt.gasUsed * receipt.gasPrice).toString();
          delete record.signed;
          cs.spent = (BigInt(cs.spent) + BigInt(record.actualCost)).toString();
          atomic(journalPath, journal, true);
          publishRecord(manifest.chains[key], module, record);
          atomic("public/deployments.json", manifest);
          console.log(key, name, record.address, record.hash);
          nonce = await p.getTransactionCount(address, "pending");
        } else nonce++;
      }
      plan.chains[key] = {
        chainId: n.id,
        balance: formatEther(balance),
        budget: formatEther(cap),
        conservativeMaximumCost: formatEther(total),
        funded: balance >= total,
        entries,
      };
    } finally {
      p.destroy();
    }
  }
  atomic("deployments/plan.json", plan);
  if (broadcast) atomic("public/deployments.json", manifest);
  else {
    console.log(JSON.stringify(plan, null, 2));
  }
}
main().catch((e) => {
  const known = [
    "Unknown chain",
    "Deployment identity",
    "RPC chain",
    "Gas price",
    "Set a total",
    "Prepared bytecode",
    "Confirmed contract",
    "Deployment simulation",
    "Deployment budget",
    "Insufficient gas",
    "Saved transaction",
    "Saved nonce",
    "Pending transaction",
    "Deployment failed",
  ];
  console.error(
    known.some((x) => e.message?.startsWith(x))
      ? e.message
      : "Deployment stopped; local state preserved. Review configuration and RPC availability.",
  );
  process.exitCode = 1;
});
