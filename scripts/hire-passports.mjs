import { id as contentHash } from "ethers";
import { PAY_NETWORK } from "../src/lib/agent-pay.ts";
const fail = (code) => {
  throw Error(code);
};
export function passports(db, now) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS passport_signatures(
      proof TEXT PRIMARY KEY, name TEXT NOT NULL, wallet TEXT NOT NULL,
      block INTEGER NOT NULL, created INTEGER NOT NULL, envelope TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS passport_works(
      entry TEXT PRIMARY KEY, proof TEXT NOT NULL UNIQUE, name TEXT NOT NULL, wallet TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS passport_authors ON passport_works(name,wallet);
    CREATE TABLE IF NOT EXISTS passport_reviews(
      entry TEXT NOT NULL, proof TEXT NOT NULL UNIQUE, name TEXT NOT NULL, wallet TEXT NOT NULL,
      verdict TEXT NOT NULL, note TEXT NOT NULL, PRIMARY KEY(entry,wallet), UNIQUE(entry,name));
    CREATE INDEX IF NOT EXISTS passport_reviewers ON passport_reviews(name,wallet);`);
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  function eligible(row) {
    return (
      row.owner.startsWith("0x") &&
      row.brief !== "studio" &&
      row.selected === row.id &&
      row.owner !== row.requester
    );
  }
  function lookupWork(entry) {
    const row = one(
      "SELECT e.id,e.brief,e.owner,e.line,b.owner AS requester,b.selected,b.title FROM entries e JOIN briefs b ON b.id=e.brief WHERE e.id=?",
      entry,
    );
    if (!row) fail("HIRE_MISSING");
    return row;
  }
  function work(entry) {
    const row = lookupWork(entry);
    if (!eligible(row)) fail("PASSPORT_INELIGIBLE");
    return row;
  }
  function prepare(input) {
    if (typeof input.entry !== "string" || input.entry.length > 40)
      fail("HIRE_INPUT");
    const row = work(input.entry);
    const action = { kind: input.kind, brief: row.brief, entry: row.id };
    if (input.kind === "review") {
      if (!one("SELECT 1 FROM passport_works WHERE entry=?", row.id))
        fail("PASSPORT_UNLISTED");
      if (
        !["confirmed", "needs_evidence"].includes(input.verdict) ||
        typeof input.note !== "string" ||
        !input.note.trim() ||
        input.note.trim().length > 320 ||
        /[\u0000-\u001f\u007f]/.test(input.note.trim())
      )
        fail("HIRE_INPUT");
      action.verdict = input.verdict;
      action.note = input.note.trim();
    }
    const statement = {
      entry: row.id,
      brief: row.brief,
      title: row.title,
      author: row.owner,
      workHash: contentHash(row.line),
    };
    if (action.kind === "review")
      Object.assign(statement, { verdict: action.verdict, note: action.note });
    action.summary = [
      action.kind === "showcase"
        ? "Publish this accepted work in my public Agent ID portfolio and invite peer review."
        : "Publish my signed review of this accepted work.",
      JSON.stringify(statement),
    ];
    return action;
  }
  function save(a, stamp, c, signature, proof) {
    const row = work(a.entry);
    if (a.kind === "showcase") {
      if (row.owner !== c.addr) fail("HIRE_OWNER");
      if (one("SELECT 1 FROM passport_works WHERE entry=?", a.entry))
        fail("PASSPORT_DUPLICATE");
    } else {
      if (!one("SELECT 1 FROM passport_works WHERE entry=?", a.entry))
        fail("PASSPORT_UNLISTED");
      if ([row.owner, row.requester].includes(c.addr)) fail("PASSPORT_PARTY");
      if (
        one(
          "SELECT 1 FROM passport_reviews WHERE entry=? AND (wallet=? OR name=?)",
          a.entry,
          c.addr,
          stamp.name,
        )
      )
        fail("PASSPORT_DUPLICATE");
    }
    const envelope = JSON.stringify({
      domain: c.domain,
      types: c.types,
      message: c.value,
      signature,
    });
    db.prepare("INSERT INTO passport_signatures VALUES(?,?,?,?,?,?)").run(
      proof,
      stamp.name,
      c.addr,
      stamp.block,
      now(),
      envelope,
    );
    if (a.kind === "showcase")
      db.prepare("INSERT INTO passport_works VALUES(?,?,?,?)").run(
        a.entry,
        proof,
        stamp.name,
        c.addr,
      );
    else
      db.prepare("INSERT INTO passport_reviews VALUES(?,?,?,?,?,?)").run(
        a.entry,
        proof,
        stamp.name,
        c.addr,
        a.verdict,
        a.note,
      );
    return { brief: row.brief, entry: a.entry, proof };
  }
  const join =
    " FROM passport_works w JOIN entries e ON e.id=w.entry JOIN briefs b ON b.id=e.brief AND b.selected=e.id JOIN passport_signatures p ON p.proof=w.proof LEFT JOIN rewards r ON r.brief=b.id ";
  const fields =
    "w.entry,w.name,w.proof,b.title,b.id brief,p.created,(SELECT COUNT(*) FROM passport_reviews v WHERE v.entry=w.entry) reviews,CASE WHEN r.state='paid' THEN r.tx END tx";
  function list(params, identity) {
    const before = Number(params.get("before") || Number.MAX_SAFE_INTEGER);
    if (!Number.isSafeInteger(before) || before <= 0) fail("HIRE_INPUT");
    const fromReview = params.get("role") === "reviewer" && identity;
    const where = [],
      args = [];
    if (identity) {
      where.push(
        fromReview ? "v.name=? AND v.wallet=?" : "w.name=? AND w.wallet=?",
      );
      args.push(identity.name, identity.wallet);
    }
    if (params.get("pending") === "1")
      where.push(
        "NOT EXISTS(SELECT 1 FROM passport_reviews y WHERE y.entry=w.entry)",
      );
    const cursor = fromReview ? "v.rowid" : "w.rowid";
    where.push(cursor + "<?");
    args.push(before);
    const rows = all(
      "SELECT " +
        fields +
        "," +
        cursor +
        " cursor" +
        (fromReview ? ",v.verdict" : "") +
        join +
        (fromReview ? " JOIN passport_reviews v ON v.entry=w.entry " : "") +
        " WHERE " +
        where.join(" AND ") +
        " ORDER BY " +
        cursor +
        " DESC LIMIT 21",
      ...args,
    );
    const more = rows.length > 20;
    if (more) rows.pop();
    return { items: rows, next: more ? rows.at(-1).cursor : null };
  }
  function card(entry, params = new URLSearchParams()) {
    const row = one("SELECT " + fields + join + " WHERE w.entry=?", entry);
    if (!row) return null;
    const before = Number(params.get("before") || Number.MAX_SAFE_INTEGER);
    if (!Number.isSafeInteger(before) || before <= 0) fail("HIRE_INPUT");
    const reviews = all(
      "SELECT v.proof,v.name,v.note,v.verdict,p.created,v.rowid cursor FROM passport_reviews v JOIN passport_signatures p ON p.proof=v.proof WHERE v.entry=? AND v.rowid<? ORDER BY v.rowid DESC LIMIT 21",
      entry,
      before,
    );
    const more = reviews.length > 20;
    if (more) reviews.pop();
    return {
      ...row,
      reviewCount: row.reviews,
      reviews,
      next: more ? reviews.at(-1).cursor : null,
    };
  }
  function profile(stamp, params) {
    const { wallet, name } = stamp;
    const totals = one(
      "SELECT COUNT(*) works,COUNT(CASE WHEN r.state='paid' AND r.tx IS NOT NULL THEN 1 END) paid,COUNT(DISTINCT CASE WHEN EXISTS(SELECT 1 FROM passport_reviews v WHERE v.entry=w.entry) THEN w.entry END) reviewed" +
        join +
        " WHERE w.wallet=? AND w.name=?",
      wallet,
      name,
    );
    totals.contributions = one(
      "SELECT count(*) n FROM passport_reviews WHERE wallet=? AND name=?",
      wallet,
      name,
    ).n;
    return { ...stamp, totals, ...list(params, stamp) };
  }
  function proof(id) {
    const s = one(
      "SELECT name,wallet,block,created,envelope FROM passport_signatures WHERE proof=?",
      id,
    );
    if (!s) fail("HIRE_MISSING");
    const { envelope, ...at } = s;
    return {
      registry: PAY_NETWORK.agentId,
      chainId: 56,
      ...at,
      ...JSON.parse(envelope),
    };
  }
  function record(entry, params) {
    const row = work(entry);
    return {
      entry,
      brief: row.brief,
      title: row.title,
      line: row.line,
      card: card(entry, params),
    };
  }
  return {
    prepare,
    save,
    list,
    card,
    record,
    profile,
    proof,
    canFeature(entry) {
      return eligible(lookupWork(entry));
    },
  };
}
