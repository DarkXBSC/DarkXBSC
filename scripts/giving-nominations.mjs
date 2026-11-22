import { randomUUID } from "node:crypto";
import { getAddress, verifyMessage } from "ethers";

export function createNominationBook({
  db,
  seal,
  open,
  identity,
  mac,
  now = Date.now,
}) {
  db.exec(`CREATE TABLE IF NOT EXISTS nominations(
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, reason TEXT NOT NULL,
    recipient TEXT NOT NULL, beneficiaryKey TEXT NOT NULL, created INTEGER NOT NULL,
    UNIQUE(owner,beneficiaryKey));
    CREATE TABLE IF NOT EXISTS nominationRoutes(token TEXT PRIMARY KEY, nomination TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS nominationRoutes_by_id ON nominationRoutes(nomination);`);
  if (!db.prepare("PRAGMA table_info(nominationRoutes)").all().some(c => c.name === "chain")) {
    db.exec("BEGIN IMMEDIATE");
    try {
      if (!db.prepare("PRAGMA table_info(nominationRoutes)").all().some(c => c.name === "chain")) db.exec(`
      ALTER TABLE nominationRoutes RENAME TO nominationRoutes_old;
      CREATE TABLE nominationRoutes(token TEXT NOT NULL,nomination TEXT NOT NULL,chain INTEGER NOT NULL DEFAULT 56,PRIMARY KEY(chain,token));
      INSERT INTO nominationRoutes SELECT token,nomination,56 FROM nominationRoutes_old;
      DROP TABLE nominationRoutes_old;
      CREATE INDEX nominationRoutes_by_id ON nominationRoutes(nomination);`);
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
  }
  const challenges = new Map();
  function challenge(input, origin) {
    const address = getAddress(input.address);
    const title = String(input.title ?? "").trim(),
      reason = String(input.reason ?? "").trim();
    const handle = String(input.recipient ?? "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
    if (
      !/^[a-z0-9_]{1,15}$/.test(handle) ||
      !title ||
      title.length > 80 ||
      !reason ||
      reason.length > 320 ||
      input.confirmed !== true ||
      /[@\u0000-\u001f]/u.test(title + reason) ||
      /(?:x\.com|twitter\.com)\//i.test(title + reason) ||
      new RegExp("(^|[^a-z0-9_])" + handle + "([^a-z0-9_]|$)", "i").test(
        title + " " + reason,
      )
    )
      throw Error("INVALID_NOMINATION");
    for (const [id, c] of challenges)
      if (c.expires <= now()) challenges.delete(id);
    if (challenges.size >= 256) throw Error("TOO_MANY_REQUESTS");
    const id = randomUUID(),
      expires = now() + 300000;
    const message = [
      "Dark · Publish giving nomination",
      origin,
      "BNB Smart Chain (56)",
      address,
      "Public title: " + title,
      "Public reason: " + reason,
      "Private X beneficiary: @" + handle,
      "Publish my wallet as nominator. No spending permission.",
      "Nonce: " + id,
      "Expires: " + new Date(expires).toISOString(),
    ].join("\n");
    challenges.set(id, { address, title, reason, handle, expires, message });
    return { id, message };
  }
  async function publish({ id, signature }, verifyAgent) {
    const c = challenges.get(id);
    if (!c || c.expires <= now()) throw Error("CHALLENGE_EXPIRED");
    let address;
    try {
      address = verifyMessage(c.message, signature);
    } catch {
      throw Error("INVALID_SIGNATURE");
    }
    if (address !== c.address) throw Error("INVALID_SIGNATURE");
    challenges.delete(id);
    if (!(await verifyAgent(address)).eligible)
      throw Error("AGENT_ID_REQUIRED");
    const recipient = await identity(c.handle);
    const key = mac("nomination-beneficiary", recipient.id).toString("hex");
    const nomination = randomUUID();
    db.prepare(
      "INSERT INTO nominations(id,owner,title,reason,recipient,beneficiaryKey,created) VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner,beneficiaryKey) DO NOTHING",
    ).run(nomination, address, c.title, c.reason, seal(recipient), key, now());
    return detail(
      db
        .prepare(
          "SELECT id FROM nominations WHERE owner=? AND beneficiaryKey=?",
        )
        .get(address, key).id,
    );
  }
  function detail(id) {
    const row = db
      .prepare(
        "SELECT id,owner,title,reason,created FROM nominations WHERE id=?",
      )
      .get(id);
    if (!row) throw Error("NOMINATION_NOT_FOUND");
    const routes = db
      .prepare(
        `SELECT r.token,r.chain AS chainId,r.received,b.stage,b.cents
      FROM nominationRoutes n JOIN routes r ON r.token=n.token AND r.chain=n.chain
      LEFT JOIN batches b ON b.route=r.idx WHERE n.nomination=? ORDER BY r.idx,b.id`,
      )
      .all(id);
    const funded = new Map();
    for (const r of routes) {
      if (BigInt(r.received) === 0n && !r.stage) continue;
      const key = r.chainId + ":" + r.token;
      const summary = funded.get(key) ?? {
        chainId: r.chainId,
        token: r.token,
        paidCents: 0n,
        stage: "collecting",
      };
      summary.stage = r.stage || "collecting";
      summary.paidCents += BigInt(r.cents || 0);
      funded.set(key, summary);
    }
    return {
      ...row,
      receipts: [...funded.values()].map((r) => ({
        ...r,
        paidCents: String(r.paidCents),
      })),
    };
  }
  function list(before = 0, owner = "") {
    if (owner) owner = getAddress(owner);
    if (!Number.isSafeInteger(before) || before < 0)
      throw Error("INVALID_NOMINATION");
    const rows = db
      .prepare(
        "SELECT rowid AS cursor,id FROM nominations WHERE (?=0 OR rowid<?) AND (?='' OR owner=?) ORDER BY rowid DESC LIMIT 21",
      )
      .all(before, before, owner, owner);
    return {
      ...(owner
        ? {
            paidBeneficiaries: db
              .prepare(
                `SELECT COUNT(DISTINCT n.beneficiaryKey) AS total FROM nominations n
        JOIN nominationRoutes nr ON nr.nomination=n.id JOIN routes r ON r.token=nr.token AND r.chain=nr.chain JOIN batches b ON b.route=r.idx
        WHERE n.owner=? AND b.cents!='0'`,
              )
              .get(owner).total,
          }
        : {}),
      items: rows.slice(0, 20).map((r) => detail(r.id)),
      next: rows.length > 20 ? rows[19].cursor : null,
    };
  }
  async function resolve(id) {
    if (typeof id !== "string" || !/^[\da-f-]{36}$/.test(id))
      throw Error("NOMINATION_NOT_FOUND");
    const row = db
      .prepare("SELECT recipient FROM nominations WHERE id=?")
      .get(id);
    if (!row) throw Error("NOMINATION_NOT_FOUND");
    const saved = open(row.recipient),
      live = await identity(saved.handle);
    if (saved.id !== live.id) throw Error("RECIPIENT_CHANGED");
    return live;
  }
  return { challenge, publish, detail, list, resolve };
}
