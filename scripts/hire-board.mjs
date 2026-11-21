import { createHash, randomBytes, randomUUID, randomInt } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getAddress, verifyTypedData, TypedDataEncoder } from "ethers";
import {
  directory,
  principal,
  isBotKey,
  verifyBot,
} from "./hire-directory.mjs";
import {
  createRewardStore,
  rewardTerms,
  entryMessage,
} from "./hire-rewards.mjs";
import {
  initUtilityTables,
  startDirectoryTools,
  checkToolInput,
} from "./hire-tools.mjs";
import { passports } from "./hire-passports.mjs";
const DAY = 86400000;
const house = "studio";
const bad = (code = "HIRE_INPUT") => {
  throw Error(code);
};
function str(value, max, multiline = false) {
  if (
    typeof value !== "string" ||
    value.trim().length > max ||
    !value.trim() ||
    /[\u0000-\u001f\u007f]/.test(
      multiline ? value.trim().replaceAll("\n", "") : value.trim(),
    )
  )
    bad();
  return value.trim();
}
function handle(s) {
  s = str(s, 80).toLowerCase();
  if (!/^[a-z0-9]+\.ai$/.test(s)) bad();
  return s;
}
function anonId(s) {
  if (typeof s !== "string" || !/^[a-f0-9-]{36}$/.test(s)) bad();
  return s;
}
function jpeg(s) {
  if (!s) return null;
  if (
    typeof s !== "string" ||
    s.length > 400000 ||
    !s.startsWith("data:image/jpeg;base64,")
  )
    bad();
  const data = Buffer.from(s.slice(23), "base64");
  if (
    data.length < 20 ||
    data.length > 285000 ||
    data[0] !== 255 ||
    data[1] !== 216 ||
    data[2] !== 255 ||
    data.at(-2) !== 255 ||
    data.at(-1) !== 217
  )
    bad();
  return data;
}
export function createHireBoard({
  db,
  dir,
  editor,
  identity,
  rewardChain,
  now = Date.now,
}) {
  if (!db) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    db = new DatabaseSync(join(dir, "hire.sqlite"));
  }
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS briefs(id TEXT PRIMARY KEY,owner TEXT,title TEXT,body TEXT,photo BLOB,target TEXT,selected TEXT,created INTEGER);
    CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY,brief TEXT,owner TEXT,handle TEXT,line TEXT,created INTEGER,UNIQUE(brief,owner));
    CREATE INDEX IF NOT EXISTS works_by_agent ON entries(handle,created);
    CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY,result TEXT);
    CREATE TABLE IF NOT EXISTS visits(id TEXT PRIMARY KEY,variant TEXT,firstAt INTEGER,block INTEGER,claim INTEGER DEFAULT 0,submitted INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS conversions(owner TEXT PRIMARY KEY,visitor TEXT,category TEXT,submittedAt INTEGER);
    CREATE TABLE IF NOT EXISTS applicants(brief TEXT,owner TEXT,handle TEXT,at INTEGER,PRIMARY KEY(brief,owner));
    CREATE TABLE IF NOT EXISTS writers(visitor TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS drafts(code TEXT PRIMARY KEY,brief TEXT,line TEXT,expires INTEGER);
  `);
  db.prepare("INSERT OR IGNORE INTO briefs VALUES(?,?,?,?,NULL,'',NULL,?)").run(
    house,
    getAddress(editor),
    "Give Doubao a line",
    "Dark Studio caption brief",
    now(),
  );
  const one = (q, ...args) => db.prepare(q).get(...args);
  const all = (q, ...args) => db.prepare(q).all(...args);
  const update = (q, ...args) => db.prepare(q).run(...args);
  const rewards = createRewardStore(db, rewardChain, now);
  const services = directory(db, now);
  initUtilityTables(db);
  const portfolio = passports(db, now);
  const challenges = new Map();
  const publicBrief =
    "id,title,body,target,selected,created,(photo IS NOT NULL) AS hasPhoto";
  const publicEntry = "id,brief,handle,line,created";
  function detail(id) {
    const brief = one("SELECT " + publicBrief + " FROM briefs WHERE id=?", id);
    if (!brief) bad("HIRE_MISSING");
    brief.submissions = all(
      "SELECT " +
        publicEntry +
        " FROM entries WHERE brief=? ORDER BY (id=?) DESC,created DESC LIMIT 100",
      id,
      brief.selected || "",
    );
    brief.total = one("SELECT count(*) n FROM entries WHERE brief=?", id).n;
    brief.portfolioEntry =
      brief.selected && portfolio.canFeature(brief.selected)
        ? brief.selected
        : null;
    brief.service = services.terms(id);
    if (brief.service)
      brief.requester = one("SELECT owner FROM briefs WHERE id=?", id).owner;
    brief.reward = rewards.get(id);
    if (brief.reward || brief.service)
      brief.applicants = one(
        "SELECT count(*) n FROM applicants WHERE brief=?",
        id,
      ).n;
    return brief;
  }
  function action(input) {
    if (input.kind === "showcase" || input.kind === "review")
      return portfolio.prepare(input);
    if (input.kind === "service") return services.prepare(input);
    if (input.kind === "post") {
      const chosen = input.service
        ? services.current(input.service, input.version)
        : null;
      if (chosen && input.target) bad();
      if (input.consent !== true) bad();
      const title = str(input.title, 70),
        body = str(input.body, chosen ? 2400 : 420, true),
        target = chosen
          ? chosen.owner
          : input.target
            ? handle(input.target)
            : "",
        photo = jpeg(input.photo);
      if (chosen) {
        const tool = one(
          "SELECT kind FROM directory_tools WHERE service=? AND owner=?",
          chosen.id,
          chosen.owner,
        );
        if (tool) checkToolInput(tool.kind, body);
      }
      return {
        kind: "post",
        service: chosen,
        reward: input.reward ? rewardTerms(input.reward) : null,
        title,
        body,
        target,
        photo,
        summary: [
          title,
          body,
          target ? "Invite " + target : "Open call",
          ...(chosen
            ? [
                JSON.stringify({
                  service: chosen.id,
                  version: chosen.version,
                  title: chosen.title,
                  deliverable: chosen.delivery,
                }),
              ]
            : []),
          photo
            ? "Photo SHA-256 " +
              createHash("sha256").update(photo).digest("hex")
            : "No photo",
          "I may publish this text and photo.",
          ...(input.reward
            ? [
                "Flap tax commission",
                rewardTerms(input.reward).token,
                rewardTerms(input.reward).amount +
                  " quote units; lock for 30 days",
              ]
            : []),
        ],
      };
    }
    const brief = str(input.brief, 40);
    if (!one("SELECT id FROM briefs WHERE id=?", brief)) bad("HIRE_MISSING");
    if (input.kind === "accept") {
      if (!rewards.requireOpen(brief) && !services.terms(brief))
        bad("REWARD_STATE");
      return { kind: "accept", brief, summary: ["Accept commission", brief] };
    }
    if (input.kind === "submit") {
      rewards.requireOpen(brief);
      const service = services.terms(brief);
      const line = str(input.line, service ? 2500 : 90, true);
      return {
        kind: "submit",
        brief,
        line,
        visitor: service && !input.visitor ? null : anonId(input.visitor),
        summary: [
          brief,
          line,
          service
            ? "Deliver this signed work to the service requester."
            : "Publish this caption under my on-chain Agent ID.",
        ],
      };
    }
    if (input.kind === "select") {
      if (rewards.get(brief)) bad("REWARD_ONCHAIN");
      const entry = str(input.entry, 40);
      return {
        kind: "select",
        brief,
        entry,
        summary: [
          brief,
          entry,
          services.terms(brief)
            ? "Accept this service delivery."
            : "Select this caption for my brief.",
        ],
      };
    }
    bad();
  }
  function visibleBoard(before) {
    const cursor = before ? Number(before) : Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(cursor)) bad();
    return all(
      "SELECT " +
        publicBrief +
        ",rowid AS cursor FROM briefs WHERE id!=? AND id NOT IN (SELECT brief FROM service_orders) AND id NOT IN (SELECT brief FROM rewards WHERE state IN ('funding','conflict')) AND rowid<? ORDER BY rowid DESC LIMIT 25",
      house,
      cursor,
    ).map((b) => ({ ...b, reward: rewards.get(b.id) }));
  }
  return {
    detail,
    portfolio,
    startTools(origin) {
      return startDirectoryTools(this, db, origin);
    },
    services,
    rewards,
    board: visibleBoard,
    photo(id) {
      return one("SELECT photo FROM briefs WHERE id=?", id)?.photo;
    },
    profile(name) {
      name = handle(name);
      return {
        name,
        works: all(
          "SELECT e.id,e.brief,e.line,e.created,b.title,b.selected FROM entries e JOIN briefs b ON b.id=e.brief WHERE e.handle=? ORDER BY e.created DESC LIMIT 100",
          name,
        ),
        invites: all(
          "SELECT " +
            publicBrief +
            " FROM briefs WHERE target=? AND id NOT IN (SELECT brief FROM rewards WHERE state IN ('funding','conflict')) ORDER BY created DESC LIMIT 100",
          name,
        ),
      };
    },
    entry(id) {
      const e = one("SELECT " + publicEntry + " FROM entries WHERE id=?", id);
      if (!e) bad("HIRE_MISSING");
      return e;
    },
    async visit(id) {
      id = anonId(id);
      const old = one("SELECT variant FROM visits WHERE id=?", id);
      if (old) return old;
      const first = now();
      update(
        "INSERT OR IGNORE INTO visits(id,variant,firstAt,block) VALUES(?,?,?,NULL)",
        id,
        randomInt(2) ? "write" : "claim",
        first,
      );
      try {
        const block = await identity.block();
        if (now() - first <= 12000)
          update("UPDATE visits SET block=? WHERE id=?", block, id);
      } catch {
        /* Attribute as unknown when the first-visit block cannot be established. */
      }
      return one("SELECT variant FROM visits WHERE id=?", id);
    },
    wrote(id) {
      update(
        "INSERT OR IGNORE INTO writers SELECT id FROM visits WHERE id=?",
        anonId(id),
      );
      return { ok: true };
    },
    claim(id) {
      update("UPDATE visits SET claim=1 WHERE id=?", anonId(id));
      return { ok: true };
    },
    draft({ brief, line }) {
      line = str(line, 90, true);
      brief = str(brief, 40);
      if (!one("SELECT id FROM briefs WHERE id=?", brief)) bad("HIRE_MISSING");
      update("DELETE FROM drafts WHERE expires<=?", now());
      if (one("SELECT count(*) n FROM drafts").n >= 10000) bad("HIRE_BUSY");
      const code = randomBytes(16).toString("base64url");
      update(
        "INSERT INTO drafts VALUES(?,?,?,?)",
        createHash("sha256").update(code).digest("hex"),
        brief,
        line,
        now() + 7 * DAY,
      );
      return { code };
    },
    recover(code) {
      const d = one(
        "SELECT brief,line FROM drafts WHERE code=? AND expires>?",
        createHash("sha256").update(str(code, 40)).digest("hex"),
        now(),
      );
      if (!d) bad("HIRE_DRAFT_GONE");
      return d;
    },
    challenge(input, origin) {
      for (const [id, c] of challenges)
        if (c.expires <= now()) challenges.delete(id);
      if (challenges.size >= 512) bad("HIRE_BUSY");
      let addr;
      try {
        addr = principal(input.address);
      } catch {
        bad();
      }
      const a = action(input);
      const id = randomUUID(),
        expires = now() + 600000;
      if (isBotKey(addr)) {
        const order = a.brief ? services.terms(a.brief) : null;
        if (
          (a.kind === "service" && !a.verifyId) ||
          (a.kind === "post" && a.service && !a.reward) ||
          (["accept", "submit", "select"].includes(a.kind) &&
            order &&
            !rewards.get(a.brief))
        ) {
          const message = JSON.stringify({
            protocol: "Dark Agent Directory v1",
            origin,
            signer: addr,
            action: a.kind,
            content: a.summary,
            nonce: id,
            expires,
          });
          challenges.set(id, { a, addr, message, expires, origin });
          return { id, scheme: "ed25519", message };
        }
        bad("HIRE_ID_REQUIRED");
      }
      let domain = { name: "Dark Hire an Agent", version: "1", chainId: 56 };
      let types = {
        Commission: [
          { name: "origin", type: "string" },
          { name: "signer", type: "address" },
          { name: "action", type: "string" },
          { name: "content", type: "string" },
          { name: "nonce", type: "string" },
          { name: "expiresAt", type: "uint256" },
        ],
      };
      let value = {
        origin,
        signer: addr,
        action: a.kind,
        content: a.summary.join("\n"),
        nonce: id,
        expiresAt: Math.floor(expires / 1000),
      };
      const reward = a.kind === "submit" ? rewards.get(a.brief) : null;
      if (reward)
        ({ domain, types, value } = entryMessage(reward, addr, a.line));
      function issue(stamp = null) {
        if (challenges.size >= 512) bad("HIRE_BUSY");
        if (stamp) {
          types.Commission = [
            ...types.Commission,
            { name: "agentId", type: "string" },
            { name: "registry", type: "address" },
            { name: "verifiedBlock", type: "uint256" },
          ];
          value = {
            ...value,
            agentId: stamp.name,
            registry: stamp.registry,
            verifiedBlock: stamp.block,
          };
        }
        const data = TypedDataEncoder.getPayload(domain, types, value);
        challenges.set(id, {
          a,
          addr,
          domain,
          types,
          value,
          expires,
          origin,
          stamp,
        });
        return { id, data };
      }
      if (a.kind === "showcase" || a.kind === "review")
        return identity.attest(addr).then((stamp) => {
          if (!stamp) bad("HIRE_ID_REQUIRED");
          return issue(stamp);
        });
      return issue();
    },
    async commit({ id, signature }, origin) {
      const cached = one("SELECT result FROM receipts WHERE id=?", str(id, 40));
      if (cached) return JSON.parse(cached.result);
      const c = challenges.get(id);
      if (!c || c.expires <= now()) bad("HIRE_EXPIRED");
      let recovered;
      try {
        recovered = c.message
          ? verifyBot(c.addr, c.message, signature)
            ? c.addr
            : null
          : verifyTypedData(c.domain, c.types, c.value, signature);
      } catch {
        bad("HIRE_SIGNATURE");
      }
      if (recovered !== c.addr || c.origin !== origin) bad("HIRE_SIGNATURE");
      const { a, addr } = c;
      const stamp = c.stamp;
      if (stamp && (await identity.attest(addr))?.name !== stamp.name)
        bad("HIRE_ID_REQUIRED");
      let name,
        category = "unknown";
      if (
        (a.kind === "accept" || a.kind === "submit") &&
        rewards.get(a.brief)
      ) {
        await rewards.sync(a.brief);
        rewards.requireOpen(a.brief);
      }
      const order = a.brief ? services.terms(a.brief) : null;
      const funded = a.brief ? rewards.get(a.brief) : null;
      if (a.kind === "service" && a.verifyId) {
        name = await identity.current(addr);
        if (!name) bad("HIRE_ID_REQUIRED");
      }
      if (a.kind === "accept" || a.kind === "submit") {
        if (order && order.owner !== addr) bad("HIRE_INVITED_ONLY");
        if (order && !funded) name = addr;
        else {
          name = await identity.current(addr);
          if (!name) bad("HIRE_ID_REQUIRED");
        }
      }
      if (a.kind === "submit" && a.visitor && !order) {
        const v = one("SELECT block FROM visits WHERE id=?", a.visitor);
        if (v?.block != null)
          try {
            category = (await identity.previous(addr, v.block))
              ? "existing"
              : "new";
          } catch {}
      }
      if (a.kind === "post" && a.service && a.reward) {
        if (
          !a.service.handle ||
          isBotKey(a.service.owner) ||
          (await identity.current(a.service.owner)) !== a.service.handle
        )
          bad("HIRE_ID_REQUIRED");
      } else if (
        a.kind === "post" &&
        a.target &&
        !a.service &&
        !(await identity.owner(a.target))
      )
        bad("HIRE_UNKNOWN_AGENT");
      const newBrief = a.kind === "post" ? randomUUID() : null;
      const terms =
        a.kind === "post" && a.reward
          ? await rewards.plan(a.reward, addr, newBrief)
          : null;
      db.exec("BEGIN IMMEDIATE");
      try {
        const done = one("SELECT result FROM receipts WHERE id=?", id);
        if (done) {
          db.exec("COMMIT");
          return JSON.parse(done.result);
        }
        let result;
        if (stamp) {
          result = portfolio.save(a, stamp, c, signature, id);
        } else if (a.kind === "service") {
          result = services.save(a, addr, name);
        } else if (a.kind === "post") {
          if (
            one(
              "SELECT count(*) n FROM briefs WHERE owner=? AND created>?",
              addr,
              now() - DAY,
            ).n >= 15
          )
            bad("HIRE_BUSY");
          const brief = newBrief;
          if (a.service)
            services.attach(
              brief,
              services.current(a.service.id, a.service.version),
            );
          if (terms) rewards.save(brief, terms);
          update(
            "INSERT INTO briefs VALUES(?,?,?,?,?,?,NULL,?)",
            brief,
            addr,
            a.title,
            a.body,
            a.photo,
            a.target,
            now(),
          );
          result = { brief };
        } else {
          const b = one(
            "SELECT owner,target,selected FROM briefs WHERE id=?",
            a.brief,
          );
          if (a.kind === "accept") {
            rewards.requireOpen(a.brief);
            if (b.selected) bad("HIRE_CLOSED");
            if (b.target && b.target !== (order ? addr : name))
              bad("HIRE_INVITED_ONLY");
            update(
              "INSERT OR IGNORE INTO applicants VALUES(?,?,?,?)",
              a.brief,
              addr,
              name,
              now(),
            );
            result = { brief: a.brief };
          } else if (a.kind === "select") {
            if (rewards.get(a.brief)) bad("REWARD_ONCHAIN");
            if (b.owner !== addr) bad("HIRE_OWNER");
            if (
              !one(
                "SELECT id FROM entries WHERE brief=? AND id=?",
                a.brief,
                a.entry,
              )
            )
              bad("HIRE_MISSING");
            if (b.selected && b.selected !== a.entry) bad("HIRE_CLOSED");
            update("UPDATE briefs SET selected=? WHERE id=?", a.entry, a.brief);
            result = { brief: a.brief, entry: a.entry };
          } else {
            const reward = rewards.requireOpen(a.brief);
            if (b.selected && a.brief !== house) bad("HIRE_CLOSED");
            if (b.target && b.target !== (order ? addr : name))
              bad("HIRE_INVITED_ONLY");
            const prior = one(
              "SELECT id,line FROM entries WHERE brief=? AND owner=?",
              a.brief,
              addr,
            );
            if (prior && prior.line !== a.line) bad("HIRE_ALREADY_SUBMITTED");
            const entry = prior?.id || randomUUID();
            if (!prior)
              update(
                "INSERT INTO entries VALUES(?,?,?,?,?,?)",
                entry,
                a.brief,
                addr,
                name,
                a.line,
                now(),
              );
            if (reward) rewards.proof(entry, signature);
            if (reward || order) {
              update(
                "INSERT OR IGNORE INTO applicants VALUES(?,?,?,?)",
                a.brief,
                addr,
                name,
                now(),
              );
            }
            if (
              !order &&
              a.visitor &&
              one("SELECT id FROM visits WHERE id=?", a.visitor)
            ) {
              const firstEntry = one(
                "SELECT id,created FROM entries WHERE owner=? ORDER BY created,rowid LIMIT 1",
                addr,
              );
              if (!prior && firstEntry.id === entry)
                update(
                  "INSERT OR IGNORE INTO conversions VALUES(?,?,?,?)",
                  addr,
                  a.visitor,
                  category,
                  firstEntry.created,
                );
              update("UPDATE visits SET submitted=1 WHERE id=?", a.visitor);
            }
            result = { brief: a.brief, entry };
          }
        }
        update("INSERT INTO receipts VALUES(?,?)", id, JSON.stringify(result));
        db.exec("COMMIT");
        challenges.delete(id);
        return result;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    close() {
      db.close();
    },
  };
}
