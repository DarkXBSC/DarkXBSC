import { createPublicKey, randomUUID, verify } from "node:crypto";
import { getAddress } from "ethers";
const categories = [
  "writing",
  "translation",
  "research",
  "data",
  "design",
  "development",
  "other",
];
const languages = ["zh", "en", "both", "other"];
const fail = (m = "HIRE_INPUT") => {
  throw Error(m);
};
const identifier = /^ed25519:[0-9a-f]{64}$/;
export const isBotKey = (value) =>
  typeof value === "string" && identifier.test(value);
export function principal(value) {
  if (isBotKey(value)) return value;
  try {
    return getAddress(value);
  } catch {
    fail();
  }
}
export function verifyBot(owner, message, signature) {
  if (typeof signature !== "string" || !/^[a-fA-F0-9]{128}$/.test(signature))
    return false;
  const key = createPublicKey({
    key: Buffer.from("302a300506032b6570032100" + owner.slice(8), "hex"),
    format: "der",
    type: "spki",
  });
  return verify(
    null,
    Buffer.from(message, "utf8"),
    key,
    Buffer.from(signature, "hex"),
  );
}
export function directory(db, now) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS services(id TEXT PRIMARY KEY,owner TEXT NOT NULL,version INTEGER NOT NULL,active INTEGER NOT NULL,handle TEXT NOT NULL,category TEXT NOT NULL,language TEXT NOT NULL,agent TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,delivery TEXT NOT NULL,eta TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL);CREATE INDEX IF NOT EXISTS services_provider ON services(owner);CREATE TABLE IF NOT EXISTS service_orders(brief TEXT PRIMARY KEY,provider TEXT NOT NULL,terms TEXT NOT NULL);CREATE INDEX IF NOT EXISTS service_inbox ON service_orders(provider);",
  );
  const one = (q, ...a) => db.prepare(q).get(...a),
    all = (q, ...a) => db.prepare(q).all(...a);
  function text(s, max, multiline = false) {
    if (
      typeof s !== "string" ||
      !s.trim() ||
      s.trim().length > max ||
      /[\u0000-\u001f\u007f]/.test(
        multiline ? s.trim().replaceAll("\n", "") : s.trim(),
      )
    )
      fail();
    return s.trim();
  }
  const toolKind =
    "(SELECT kind FROM directory_tools WHERE directory_tools.service=services.id AND directory_tools.owner=services.owner) AS tool";
  function read(id) {
    const row = one(
      "SELECT *, " + toolKind + " FROM services WHERE id=?",
      text(id, 40),
    );
    if (!row) fail("HIRE_MISSING");
    return row;
  }
  function current(id, version) {
    const s = read(id);
    if (!s.active || s.version !== version) fail("SERVICE_CHANGED");
    return s;
  }
  function list(params) {
    const q = (params.get("q") || "").trim().toLowerCase(),
      category = params.get("category"),
      lang = params.get("language"),
      owner = params.get("owner"),
      before = Number(params.get("before") || Number.MAX_SAFE_INTEGER);
    if (
      q.length > 100 ||
      (category && !categories.includes(category)) ||
      (lang && !languages.includes(lang)) ||
      !Number.isSafeInteger(before) ||
      before <= 0
    )
      fail();
    const filters = [],
      values = [];
    if (owner) {
      filters.push("owner=?");
      values.push(principal(owner));
    } else filters.push("active=1");
    if (q) {
      filters.push(
        "instr(lower(agent||' '||title||' '||description||' '||delivery||' '||handle),?)>0",
      );
      values.push(q);
    }
    if (category) {
      filters.push("category=?");
      values.push(category);
    }
    if (lang) {
      filters.push("language IN (?,?)");
      values.push(lang, ["zh", "en"].includes(lang) ? "both" : lang);
    }
    const where = filters.join(" AND "),
      rows = all(
        "SELECT *,rowid cursor, " +
          toolKind +
          " FROM services WHERE " +
          where +
          " AND rowid<? ORDER BY rowid DESC LIMIT 25",
        ...values,
        before,
      );
    const more = rows.length === 25;
    if (more) rows.pop();
    return {
      items: rows,
      total: one("SELECT count(*) n FROM services WHERE " + where, ...values).n,
      next: more ? rows.at(-1).cursor : null,
    };
  }
  function prepare(input) {
    const service = input.service ? text(input.service, 40) : null,
      version = input.version ?? 0;
    if (
      !Number.isSafeInteger(version) ||
      version < 0 ||
      (!service && version !== 0) ||
      (service && version < 1)
    )
      fail();
    if (
      !categories.includes(input.category) ||
      !languages.includes(input.language) ||
      typeof input.active !== "boolean" ||
      typeof input.verifyId !== "boolean"
    )
      fail();
    const agent = text(input.agent, 45);
    if (/\.ai\b/i.test(agent)) fail("SERVICE_ALIAS");
    const fields = {
      service,
      version,
      active: input.active,
      verifyId: input.verifyId,
      category: input.category,
      language: input.language,
      agent,
      title: text(input.title, 80),
      description: text(input.description, 800, true),
      delivery: text(input.delivery, 220, true),
      eta: text(input.eta, 70),
    };
    return { kind: "service", ...fields, summary: [JSON.stringify(fields)] };
  }
  function save(a, owner, handle) {
    const args = [
      a.active ? 1 : 0,
      handle || "",
      a.category,
      a.language,
      a.agent,
      a.title,
      a.description,
      a.delivery,
      a.eta,
    ];
    if (a.service) {
      const old = read(a.service);
      if (old.owner !== owner) fail("HIRE_OWNER");
      if (old.version !== a.version) fail("SERVICE_CHANGED");
      db.prepare(
        "UPDATE services SET active=?,handle=?,category=?,language=?,agent=?,title=?,description=?,delivery=?,eta=?,updated=?,version=version+1 WHERE id=?",
      ).run(...args, now(), a.service);
      return { service: a.service, version: a.version + 1 };
    }
    if (
      one(
        "SELECT count(*) n FROM services WHERE owner=? AND created>?",
        owner,
        now() - 86400000,
      ).n >= 15
    )
      fail("HIRE_BUSY");
    const service = randomUUID();
    db.prepare("INSERT INTO services VALUES(?,?,1,?,?,?,?,?,?,?,?,?,?,?)").run(
      service,
      owner,
      ...args,
      now(),
      now(),
    );
    return { service, version: 1 };
  }
  function attach(brief, service) {
    db.prepare("INSERT INTO service_orders VALUES(?,?,?)").run(
      brief,
      service.owner,
      JSON.stringify(service),
    );
  }
  function terms(brief) {
    const row = one("SELECT terms FROM service_orders WHERE brief=?", brief);
    return row ? JSON.parse(row.terms) : null;
  }
  function orders(owner, before, direction = "inbox") {
    const cursor = Number(before || Number.MAX_SAFE_INTEGER);
    if (!Number.isSafeInteger(cursor) || cursor <= 0) fail();
    const rows = all(
      "SELECT b.id,b.title,b.selected,b.created,b.rowid cursor,json_extract(s.terms,'$.title') serviceTitle FROM service_orders s JOIN briefs b ON b.id=s.brief LEFT JOIN rewards r ON r.brief=b.id WHERE " +
        (direction === "outbox"
          ? "b.owner=?"
          : "s.provider=? AND (r.state IS NULL OR r.state NOT IN ('funding','conflict'))") +
        " AND b.rowid<? ORDER BY b.rowid DESC LIMIT 25",
      principal(owner),
      cursor,
    );
    const more = rows.length === 25;
    if (more) rows.pop();
    return { items: rows, next: more ? rows.at(-1).cursor : null };
  }
  return {
    list,
    read,
    current,
    prepare,
    save,
    attach,
    terms,
    orders,
    inbox: orders,
  };
}
