// Separate experimental artifact tree: never changes deployed standard-input.
import fs from "node:fs";
import path from "node:path";
import solc from "solc";
const entry = "contracts/experimental/DarkPayoutVault.sol";
const input = {
  language: "Solidity",
  sources: {
    [entry]: { content: fs.readFileSync(entry, "utf8") },
    "test/Fixtures.sol": {
      content: fs.readFileSync("test/Fixtures.sol", "utf8"),
    },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    evmVersion: "shanghai",
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"],
      },
    },
  },
};
const out = JSON.parse(
  solc.compile(JSON.stringify(input), {
    import(p) {
      try {
        return {
          contents: fs.readFileSync(path.join("node_modules", p), "utf8"),
        };
      } catch {
        return { error: "Import unavailable: " + p };
      }
    },
  }),
);
const errors = (out.errors || []).filter((e) => e.severity === "error");
if (errors.length)
  throw Error(errors.map((e) => e.formattedMessage).join("\n"));
fs.mkdirSync("artifacts/experimental", { recursive: true });
for (const [file, contracts] of Object.entries(out.contracts))
  if (file === entry || file === "test/Fixtures.sol")
    for (const [name, artifact] of Object.entries(contracts))
      fs.writeFileSync(
        "artifacts/experimental/" + name + ".json",
        JSON.stringify(artifact),
      );
console.log(
  "Experimental DarkPayoutVault compiled; no deployment or verified artifact changed.",
);
