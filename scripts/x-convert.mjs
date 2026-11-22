// Operator-only, local ledger. The settlement worker signs the exact journaled operation.
import { DatabaseSync } from "node:sqlite";
import dotenv from "dotenv";
import { join } from "node:path";
import { hostedLedger } from "./x-hosted.mjs";
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { JsonRpcProvider, keccak256 } from "ethers";
import { conversionBook } from "./x-tax-conversions.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    chain: { type: "string", default: "bsc" },
    token: { type: "string" },
    amount: { type: "string" },
    "min-usdt": { type: "string" },
    deposit: { type: "string" },
    id: { type: "string" },
    commit: { type: "boolean" },
    help: { type: "boolean" },
  },
});
if (values.help) {
  console.log(
    "x:convert -- list | dex | inventory | retry\ndex / inventory: --token <launch-address> --amount <pool units> --chain <bsc|base> --min-usdt <stablecoin units: BSC USDT / Base USDC> [--commit --id <unique-id>]\ninventory: also --deposit <finalized USDT transfer hash from deployment wallet>\nretry: --id <request-id> --commit (operator release with a finalized failed receipt)",
  );
  process.exit(0);
}
if (!["bsc", "base"].includes(values.chain)) throw Error("UNSUPPORTED_LAUNCH_CHAIN");
const chainId = values.chain === "base" ? 8453 : 56;
const production = process.env.DARK_OPERATOR_LEDGER === "production";
if (
  !production &&
  existsSync(".env") &&
  dotenv.parse(readFileSync(".env")).X_TAX_HOSTED === "yes"
) {
  console.error("Use darkwork-x-convert on the production server.");
  process.exit(1);
}
const db = new DatabaseSync(
  join(
    production ? hostedLedger : "deployments/private/x-tax",
    "routes.sqlite",
  ),
  {
    open: true,
  },
);
db.exec("PRAGMA busy_timeout=5000");
const book = conversionBook(db),
  method = positionals[0] || "list";
const p = new JsonRpcProvider(
  "http://127.0.0.1:" +
    Number(process.env.DARK_API_PORT || 5207) +
    "/api/rpc/" + values.chain,
  chainId,
  { staticNetwork: true, batchMaxCount: 1 },
);
try {
  const operator = JSON.parse(
    readFileSync("deployments/inspection.json"),
  ).deployer;
  if (method === "list") {
    const routes = db
      .prepare(
        "SELECT r.idx,r.token,r.address,r.chain FROM routes r JOIN poolRevenue a ON r.idx=a.route",
      )
      .all();
    console.log(
      JSON.stringify(
        {
          operator,
          routes: routes.map((r) => ({ ...r, ...book.inventory(r.idx) })),
        },
        null,
        2,
      ),
    );
  } else if (method === "dex" || method === "inventory") {
    if (
      !values.token ||
      !values.amount ||
      !values["min-usdt"] ||
      !!values.deposit !== (method === "inventory")
    )
      throw Error("INVALID_ORDER");
    const result = await book.order({
      p,
      token: values.token,
      amount: values.amount,
      minUSDT: values["min-usdt"],
      operator,
      deposit: values.deposit,
      commit: values.commit,
      requestId: values.id,
    });
    console.log(JSON.stringify(result, null, 2));
  } else if (method === "retry") {
    const j = db
      .prepare(
        "SELECT * FROM conversions WHERE requestId=? AND kind='operator' AND stage='signed'",
      )
      .get(values.id || "");
    if (!values.commit || !j || !j.raw || keccak256(j.raw) !== j.hash || db.prepare("SELECT chain FROM routes WHERE idx=?").get(j.route)?.chain !== chainId)
      throw Error("INVALID_RETRY");
    const rc = await p.getTransactionReceipt(j.hash),
      head = await p.getBlock("finalized");
    if (!rc || rc.status !== 0 || rc.blockNumber > head.number)
      throw Error("NO_FINAL_FAILED_RECEIPT");
    const saved = db
      .prepare(
        "UPDATE conversions SET stage='queued',raw=NULL,hash=NULL WHERE id=? AND hash=? AND stage='signed'",
      )
      .run(j.id, j.hash);
    console.log(JSON.stringify({ retried: saved.changes === 1, id: j.id }));
  } else throw Error("UNKNOWN_COMMAND");
} catch (e) {
  console.error(
    /^[A-Z0-9_]+$/.test(e.message)
      ? e.message
      : "Conversion request failed. Check the order, duplicate payment hash and local BSC RPC.",
  );
  process.exitCode = 1;
} finally {
  p.destroy();
  db.close();
}
