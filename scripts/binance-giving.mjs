// Local merchant settlement. Only finalized BSC USDT receipts fund payouts.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { createRecipientResolver } from "./binance-recipient.mjs";
import { join } from "node:path";
import {
  randomBytes,
  createHmac,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import {
  HDNodeWallet,
  Interface,
  JsonRpcProvider,
  formatUnits,
  parseUnits,
  getAddress,
  zeroPadValue,
  id,
} from "ethers";
export const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955";
const token = new Interface([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);

export function merchantApi(env, fetcher = fetch) {
  return async (action, body) => {
    const timestamp = Date.now().toString(),
      nonce = randomBytes(16).toString("hex"),
      payload = JSON.stringify(body);
    const signature = createHmac("sha512", env.BINANCE_PAY_SECRET)
      .update([timestamp, nonce, payload, ""].join("\n"))
      .digest("hex")
      .toUpperCase();
    const r = await fetcher(
      "https://bpay.binanceapi.com/binancepay/openapi/payout/" + action,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: {
          "Content-Type": "application/json",
          "BinancePay-Timestamp": timestamp,
          "BinancePay-Nonce": nonce,
          "BinancePay-Certificate-SN": env.BINANCE_PAY_KEY,
          "BinancePay-Signature": signature,
        },
        body: payload,
      },
    );
    const result = await r.json();
    if (!r.ok || result.status !== "SUCCESS" || result.code !== "000000")
      throw Error("MERCHANT_REQUEST_UNCONFIRMED");
    return result.data;
  };
}
export function createBinanceGiving(
  env,
  {
    dir = "deployments/private/binance-giving",
    provider,
    request,
    readArticle,
  } = {},
) {
  const resolveRecipient = createRecipientResolver(dir, readArticle);
  async function inspect(raw, validate) {
    const { uid, ...identity } = await resolveRecipient(raw);
    if (!uid) return { ...identity, state: "POST_NOT_LINKED" };
    if (!validate) return { ...identity, state: "MERCHANT_UNAVAILABLE" };
    return { ...identity, ...(await validate(uid, identity)) };
  }
  if (
    !env.BINANCE_PAY_KEY ||
    !env.BINANCE_PAY_SECRET ||
    !env.GIVING_COLLECTION_XPUB ||
    !env.GIVING_PAYOUT_MAX_USDT ||
    !env.GIVING_STORE_KEY
  )
    return { enabled: false, check: (raw) => inspect(raw) };
  if (
    !env.GIVING_COLLECTION_XPUB.startsWith("xpub") ||
    !/^\d+(\.\d{1,6})?$/.test(env.GIVING_PAYOUT_MAX_USDT) ||
    !/^([a-f0-9]{2}){32}$/i.test(env.GIVING_STORE_KEY)
  )
    throw Error("INVALID_MERCHANT_CONFIGURATION");
  const cap = parseUnits(env.GIVING_PAYOUT_MAX_USDT, 18),
    minimum = 10n ** 18n;
  if (cap < minimum || cap > parseUnits("100000", 18))
    throw Error("INVALID_MERCHANT_LIMIT");
  const node = HDNodeWallet.fromExtendedKey(env.GIVING_COLLECTION_XPUB),
    reader = provider || new JsonRpcProvider(env.BSC_RPC_URL, 56),
    pay = request || merchantApi(env),
    key = Buffer.from(env.GIVING_STORE_KEY, "hex");
  const digest = (s) => createHmac("sha256", key).update(s).digest("hex");
  function seal(s) {
    const iv = randomBytes(12),
      c = createCipheriv("aes-256-gcm", key, iv),
      b = Buffer.concat([c.update(s, "utf8"), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), b]).toString("base64");
  }
  function open(s) {
    const b = Buffer.from(s, "base64"),
      c = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
    c.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([c.update(b.subarray(28)), c.final()]).toString(
      "utf8",
    );
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const dbFile = join(dir, "ledger.sqlite"),
    db = new DatabaseSync(dbFile);
  chmodSync(dbFile, 0o600);
  db.exec(`PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS meta(fingerprint TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS routes(idx INTEGER PRIMARY KEY,tag TEXT UNIQUE,recipient TEXT NOT NULL,address TEXT UNIQUE,lastBlock INTEGER NOT NULL,received TEXT NOT NULL DEFAULT '0',paid TEXT NOT NULL DEFAULT '0');
    CREATE TABLE IF NOT EXISTS payouts(id TEXT PRIMARY KEY,route INTEGER NOT NULL,amount TEXT NOT NULL,status TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS one_pending ON payouts(route) WHERE status!='paid';`);
  const fp = digest(node.extendedKey + "|" + env.BINANCE_PAY_KEY);
  db.prepare(
    "INSERT INTO meta SELECT ? WHERE NOT EXISTS (SELECT 1 FROM meta)",
  ).run(fp);
  if (!db.prepare("SELECT 1 FROM meta WHERE fingerprint=?").get(fp))
    throw Error("MERCHANT_STORAGE_CONFIG_CHANGED");
  function atomic(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      db.exec("COMMIT");
      return out;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  async function finalized() {
    if ((await reader.getNetwork()).chainId !== 56n) throw Error("WRONG_CHAIN");
    const b = await reader.getBlock("finalized");
    if (!b) throw Error("NO_FINALITY");
    return b.number;
  }
  const ticketFor = (uid, identity) =>
    digest(
      JSON.stringify([
        "recipient-v1",
        fp,
        identity.post || "",
        identity.profile || "",
        uid,
      ]),
    );
  async function validateUid(uid) {
    if (
      (await pay("receiver/check", {
        receiveType: "BINANCE_ID",
        receiverId: uid,
      })) !== true
    )
      throw Error("UID_NOT_VALIDATED");
  }
  async function check(raw) {
    return inspect(raw, async (uid, identity) => {
      await validateUid(uid);
      return { state: "READY", ticket: ticketFor(uid, identity) };
    });
  }
  async function bind(raw, expectedTicket) {
    const { uid, ...identity } = await resolveRecipient(raw);
    if (!uid) throw Error("POST_NOT_LINKED");
    const ticket = ticketFor(uid, identity);
    if (expectedTicket !== undefined && expectedTicket !== ticket)
      throw Error("RECIPIENT_CHANGED");
    await validateUid(uid);
    const tag = digest("uid:" + uid);
    let row = db.prepare("SELECT * FROM routes WHERE tag=?").get(tag);
    if (!row) {
      const block = await finalized();
      row = atomic(() => {
        const existing = db
          .prepare("SELECT * FROM routes WHERE tag=?")
          .get(tag);
        if (existing) return existing;
        const i = Number(
          db.prepare("SELECT COALESCE(MAX(idx),-1)+1 AS idx FROM routes").get()
            .idx,
        );
        const address = node.deriveChild(i).address;
        db.prepare(
          "INSERT INTO routes(idx,tag,recipient,address,lastBlock) VALUES(?,?,?,?,?)",
        ).run(i, tag, seal(uid), address, block);
        return db.prepare("SELECT * FROM routes WHERE idx=?").get(i);
      });
    }
    return {
      ...identity,
      ticket,
      address: row.address,
      asset: BSC_USDT,
      chainId: 56,
      rail: "binance-pay",
      currency: "USDT",
    };
  }
  async function settle(r) {
    const pending = db
      .prepare("SELECT * FROM payouts WHERE route=? AND status!='paid'")
      .get(r.idx);
    const uid = open(r.recipient);
    if (pending) {
      if (pending.status === "failed") return;
      const result = await pay("query", { requestId: pending.id });
      const detail = result?.transferDetailList?.find(
        (d) => d.merchantSendId === pending.id,
      );
      if (
        !detail ||
        result.requestId !== pending.id ||
        result.currency !== "USDT" ||
        detail.receiveType !== "BINANCE_ID" ||
        String(detail.receiver) !== uid ||
        parseUnits(String(detail.amount), 18) !== BigInt(pending.amount)
      )
        return;
      if (detail.status === "SUCCESS")
        atomic(() => {
          const changed = db
            .prepare(
              "UPDATE payouts SET status='paid' WHERE id=? AND status='submitted'",
            )
            .run(pending.id);
          if (changed.changes) {
            const current = db
              .prepare("SELECT paid FROM routes WHERE idx=?")
              .get(r.idx);
            db.prepare("UPDATE routes SET paid=? WHERE idx=?").run(
              (BigInt(current.paid) + BigInt(pending.amount)).toString(),
              r.idx,
            );
          }
        });
      else if (["FAIL", "REFUNDED"].includes(detail.status))
        db.prepare(
          "UPDATE payouts SET status='failed' WHERE id=? AND status='submitted'",
        ).run(pending.id);
      return;
    }
    const available = BigInt(r.received) - BigInt(r.paid),
      amount = ((available < cap ? available : cap) / 10n ** 12n) * 10n ** 12n;
    if (amount < minimum) return;
    const payoutId = randomBytes(16).toString("hex");
    // Commit BEFORE the network call. On timeout or process failure this ID is query-only.
    const saved = db
      .prepare(
        "INSERT OR IGNORE INTO payouts(id,route,amount,status) SELECT ?,idx,?,'submitted' FROM routes WHERE idx=? AND received=? AND paid=?",
      )
      .run(payoutId, String(amount), r.idx, r.received, r.paid);
    if (!saved.changes) return;
    const decimal = Number(formatUnits(amount, 18));
    await pay("transfer", {
      requestId: payoutId,
      batchName: "Dark giving",
      bizScene: "DIRECT_TRANSFER",
      currency: "USDT",
      totalAmount: decimal,
      totalNumber: 1,
      transferDetailList: [
        {
          merchantSendId: payoutId,
          transferAmount: decimal,
          receiveType: "BINANCE_ID",
          receiver: uid,
          transferMethod: "FUNDING_WALLET",
        },
      ],
    });
  }
  let scanning = false;
  async function tick() {
    if (scanning) return;
    scanning = true;
    try {
      const end = await finalized();
      for (const r of db.prepare("SELECT * FROM routes ORDER BY idx").all()) {
        try {
          const to = Math.min(end, r.lastBlock + 500);
          if (to > r.lastBlock) {
            const logs = await reader.getLogs({
              address: BSC_USDT,
              fromBlock: r.lastBlock + 1,
              toBlock: to,
              topics: [
                id("Transfer(address,address,uint256)"),
                null,
                zeroPadValue(r.address, 32),
              ],
            });
            let delta = 0n;
            const seen = new Set();
            for (const l of logs) {
              const ref = l.transactionHash + ":" + l.index;
              if (
                l.removed ||
                l.blockNumber <= r.lastBlock ||
                l.blockNumber > to ||
                seen.has(ref) ||
                getAddress(l.address) !== BSC_USDT
              )
                continue;
              const event = token.parseLog(l);
              if (
                event?.args.to !== r.address ||
                db
                  .prepare("SELECT 1 FROM routes WHERE address=?")
                  .get(event.args.from)
              )
                continue;
              seen.add(ref);
              delta += event.args.value;
            }
            db.prepare(
              "UPDATE routes SET received=?,lastBlock=? WHERE idx=? AND lastBlock=?",
            ).run(String(BigInt(r.received) + delta), to, r.idx, r.lastBlock);
          }
          await settle(
            db.prepare("SELECT * FROM routes WHERE idx=?").get(r.idx),
          );
        } catch {
          /* Preserve the cursor or pending ID; reconciliation uses a later read. */
        }
      }
    } finally {
      scanning = false;
    }
  }
  function status(address) {
    const r = db
      .prepare("SELECT idx,received,paid,lastBlock FROM routes WHERE address=?")
      .get(getAddress(address));
    if (!r) return null;
    return {
      received: formatUnits(r.received, 18),
      paid: formatUnits(r.paid, 18),
      lastBlock: r.lastBlock,
      pending:
        db
          .prepare(
            "SELECT status FROM payouts WHERE route=? AND status!='paid'",
          )
          .get(r.idx)?.status || null,
      currency: "USDT",
    };
  }
  return { enabled: true, check, bind, status, tick, close: () => db.close() };
}
