import fs from "node:fs";
import { atomic } from "./env.mjs";
const base = "https://sourcify.dev/server",
  headers = {
    "Content-Type": "application/json",
    "User-Agent": "TigerGenesis/1.0 (+https://x.com/Tiger_AgentID)",
  };
async function main() {
  const manifest = JSON.parse(fs.readFileSync("public/deployments.json")),
    input = JSON.parse(fs.readFileSync("artifacts/standard-input.json")),
    build = JSON.parse(fs.readFileSync("artifacts/build.json"));
  const file = "deployments/verification.json";
  const jobs = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {};
  for (const [chain, c] of Object.entries(manifest.chains)) {
    for (const [key, m] of Object.entries(c.contracts)) {
      const id = chain + ":" + key;
      const a = JSON.parse(fs.readFileSync("artifacts/" + m.name + ".json"));
      if (jobs[id] && jobs[id].address !== m.address) {
        const old = jobs[id];
        jobs[id + ":" + old.address] = old;
        delete jobs[id];
        atomic(file, jobs);
      }
      if (
        jobs[id]?.verified &&
        m.verified &&
        jobs[id].lookup?.address === m.address
      )
        continue;
      if (!jobs[id]?.verificationId) {
        const r = await fetch(`${base}/v2/verify/${c.chainId}/${m.address}`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            stdJsonInput: input,
            compilerVersion: build.compiler.split(".Emscripten")[0],
            contractIdentifier: a.file + ":" + m.name,
            creationTransactionHash: m.transactionHash,
          }),
          signal: AbortSignal.timeout(60000),
        });
        const j = await r.json();
        jobs[id] = { address: m.address, status: r.status, ...j };
        atomic(file, jobs);
        console.log(
          id,
          "submitted",
          r.status,
          j.verificationId || j.message || "",
        );
      }
      const job = jobs[id];
      if (job.verificationId) {
        const r = await fetch(`${base}/v2/verify/${job.verificationId}`, {
          headers,
          signal: AbortSignal.timeout(20000),
        });
        job.result = await r.json();
        atomic(file, jobs);
      }
      const r = await fetch(`${base}/v2/contract/${c.chainId}/${m.address}`, {
        headers,
        signal: AbortSignal.timeout(20000),
      });
      if (r.ok) {
        const result = await r.json();
        job.lookup = result;
        const exact = ["match", "exact_match"];
        m.verified = exact.includes(result.runtimeMatch);
        m.verificationUrl = `https://repo.sourcify.dev/contracts/full_match/${c.chainId}/${m.address}/`;
        m.verificationApi = `${base}/v2/contract/${c.chainId}/${m.address}`;
        job.verified = m.verified;
        console.log(
          id,
          "runtime match:",
          result.runtimeMatch,
          "creation:",
          result.creationMatch,
        );
      } else console.log(id, "verification pending");
      atomic(file, jobs);
      atomic("public/deployments.json", manifest);
    }
  }
}
main().catch(() => {
  console.error(
    "Verification request did not finish; saved jobs can be resumed. No credentials logged.",
  );
  process.exitCode = 1;
});
