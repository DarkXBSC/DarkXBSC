import fs from "node:fs";
import path from "node:path";
import solc from "solc";
import {id,getCreate2Address,keccak256} from "ethers";
import { createHash } from "node:crypto";
const sources = {};
function collect(file) {
  if (sources[file]) return;
  const physical = file.startsWith("@openzeppelin-contracts-upgradeable/")
    ? "node_modules/@openzeppelin/contracts-upgradeable/" +
      file.slice("@openzeppelin-contracts-upgradeable/".length)
    : file.startsWith("@")
      ? "node_modules/" + file
      : file;
  const content = fs.readFileSync(physical, "utf8");
  sources[file] = { content };
  for (const match of content.matchAll(
    /import\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["'];/g,
  )) {
    const dep = match[1].startsWith(".")
      ? path.posix.normalize(
          path.posix.join(path.posix.dirname(file), match[1]),
        )
      : match[1];
    collect(dep);
  }
}
for (const name of fs
  .readdirSync("contracts")
  .filter((n) => n.endsWith(".sol")))
  collect("contracts/" + name);
if (process.argv.includes("--test")) collect("test/Fixtures.sol");
const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    evmVersion: "shanghai",
    outputSelection: {
      "*": { "*": ["abi", "metadata", "evm.bytecode", "evm.deployedBytecode"] },
    },
  },
};
const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors || []).filter((e) => e.severity === "error");
if (errors.length) {
  console.error(errors.map((e) => e.formattedMessage).join("\n"));
  process.exit(1);
}
fs.mkdirSync("artifacts", { recursive: true });
fs.mkdirSync("public/contracts", { recursive: true });
fs.writeFileSync(
  "artifacts/standard-input.json",
  JSON.stringify(input, null, 2),
);
for (const [file, contracts] of Object.entries(output.contracts)) {
  for (const [name, a] of Object.entries(contracts)) {
    if (["IPortal", "IVaultPortal"].includes(name)) {
      fs.writeFileSync(
        "public/contracts/" + name + ".abi.json",
        JSON.stringify(a.abi),
      );
    }
    if (!file.startsWith("contracts/Tiger") && !file.startsWith("test/"))
      continue;
    if(name==="TigerCommissionFactory"&&!process.argv.includes("--test")){
      const deployer="0x4e59b44847b379578588920cA78FbF26c0B4956C", salt=id("Dark Flap Commission Factory v1");
      const init="0x"+a.evm.bytecode.object;
      fs.writeFileSync("public/contracts/commission.json",JSON.stringify({chainId:56,deployer,deployerHash:"0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989",salt,init,address:getCreate2Address(deployer,salt,keccak256(init)),runtimeHash:keccak256("0x"+a.evm.deployedBytecode.object)}));
    }
    const bytes = a.evm.deployedBytecode.object.length / 2;
    if (bytes > 24576 || a.evm.bytecode.object.length / 2 > 49152)
      throw Error("Contract exceeds deployment limits: " + name);
    fs.writeFileSync(
      "artifacts/" + name + ".json",
      JSON.stringify({ file, name, ...a }, null, 2),
    );
    if (file.startsWith("contracts/Tiger")) {
      fs.writeFileSync(
        "public/contracts/" + name + ".abi.json",
        JSON.stringify(a.abi),
      );
      console.log(name, bytes, "runtime bytes");
    }
  }
}
const inputHash = createHash("sha256")
  .update(JSON.stringify(input))
  .digest("hex");
fs.writeFileSync(
  "artifacts/build.json",
  JSON.stringify(
    { compiler: solc.version(), inputHash, settings: input.settings },
    null,
    2,
  ),
);
if (!process.argv.includes("--test")) {
  fs.writeFileSync(
    "public/contracts/standard-input.json",
    JSON.stringify(input),
  );
  fs.writeFileSync(
    "public/contracts/build.json",
    JSON.stringify(
      { compiler: solc.version(), inputHash, license: "MIT" },
      null,
      2,
    ),
  );
  for (const f of fs.readdirSync("contracts").filter((n) => n.endsWith(".sol")))
    fs.copyFileSync("contracts/" + f, "public/contracts/" + f);
}
