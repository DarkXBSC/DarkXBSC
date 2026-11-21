import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
const specs = {
  checklist: {
    agent: "Dark Checklist",
    title: "整理任务清单 · Markdown checklist",
    category: "writing",
    description:
      "每行写一项任务。支持普通文本、编号或 Markdown 勾选框；重复项目会合并，并保留已完成状态。 Enter one task per line, optionally marked [x].",
    delivery:
      "可复制的 Markdown 清单，附完成数量 · Deduplicated task list with completion count",
    eta: "通常数秒 · Seconds",
  },
  links: {
    agent: "Dark Link Desk",
    title: "清理链接清单 · Clean a link list",
    category: "data",
    description:
      "把公开网页链接粘贴进需求。机器人在本地移除常见跟踪参数，去重并按网站归类。 Paste HTTP(S) links. The Agent processes the URLs without fetching the pages.",
    delivery: "按域名分组的干净链接清单 · Clean URLs grouped by domain",
    eta: "通常数秒 · Seconds",
  },
};
function tasks(body) {
  const result = new Map();
  for (const row of body.split("\n")) {
    const s = row.trim().replace(/^(?:[-*+]|\d+[.)])\s+/, ""),
      done = /^\[[xX]\]\s*/.test(s),
      label = s
        .replace(/^\[[ xX]\]\s*/, "")
        .trim()
        .replace(/[ \t]+/g, " ");
    if (!label || /^[-*+]$/.test(label)) continue;
    const key = label.toLowerCase(),
      prior = result.get(key);
    result.set(key, {
      label: prior?.label || label,
      done: prior?.done || done,
    });
  }
  return [...result.values()];
}
function links(body) {
  const unique = new Set();
  for (const raw of body.match(/https?:\/\/[^\s<>"\u3000，。；、]+/gi) || []) {
    try {
      const url = new URL(raw.replace(/[.,;]+$/, ""));
      if (url.username || url.password) continue;
      for (const k of [...url.searchParams.keys()])
        if (/^utm_|^(fbclid|gclid|msclkid)$/i.test(k))
          url.searchParams.delete(k);
      unique.add(url.href);
    } catch {
      /* Skip malformed text. */
    }
  }
  return [...unique].sort((a, b) =>
    new URL(a).hostname.localeCompare(new URL(b).hostname),
  );
}
export function checkToolInput(kind, body) {
  if (kind === "links" && !links(body).length)
    throw Error("SERVICE_INPUT_LINKS");
  if (kind === "checklist" && !tasks(body).length)
    throw Error("SERVICE_INPUT_TASKS");
}
export function toolResult(kind, body) {
  checkToolInput(kind, body);
  let lines;
  if (kind === "checklist") {
    const list = tasks(body);
    lines = [
      list.filter((x) => x.done).length +
        " / " +
        list.length +
        " completed · 已完成",
      ...list.map((x) => "- [" + (x.done ? "x" : " ") + "] " + x.label),
    ];
  } else {
    const urls = links(body);
    lines = [urls.length + " unique links · 不重复链接"];
    let previous;
    for (const s of urls) {
      const host = new URL(s).hostname;
      if (host !== previous) {
        lines.push("", host);
        previous = host;
      }
      lines.push(s);
    }
  }
  let out = "";
  for (const line of lines) {
    const next = out ? out + "\n" + line : line;
    if (next.length > 2450)
      return out + "\n… 超出单次交付长度 · Output limit reached";
    out = next;
  }
  return out;
}
export function initUtilityTables(db) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS directory_tools(kind TEXT PRIMARY KEY,owner TEXT UNIQUE NOT NULL,pem TEXT NOT NULL,service TEXT UNIQUE); CREATE TRIGGER IF NOT EXISTS directory_tool_single BEFORE INSERT ON services WHEN EXISTS(SELECT 1 FROM directory_tools WHERE owner=NEW.owner) AND EXISTS(SELECT 1 FROM services WHERE owner=NEW.owner) BEGIN SELECT RAISE(ABORT,'SERVICE_CHANGED'); END;",
  );
}
export function startDirectoryTools(board, db, origin) {
  const catalog = new Map();
  for (const [kind, spec] of Object.entries(specs)) {
    let row = db
      .prepare("SELECT owner,pem,service FROM directory_tools WHERE kind=?")
      .get(kind);
    if (!row) {
      const pair = generateKeyPairSync("ed25519"),
        pem = pair.privateKey.export({ format: "pem", type: "pkcs8" });
      const owner =
        "ed25519:" +
        Buffer.from(
          pair.publicKey.export({ format: "jwk" }).x,
          "base64url",
        ).toString("hex");
      db.prepare(
        "INSERT OR IGNORE INTO directory_tools(kind,owner,pem) VALUES(?,?,?)",
      ).run(kind, owner, pem);
      row = db
        .prepare("SELECT owner,pem,service FROM directory_tools WHERE kind=?")
        .get(kind);
    }
    catalog.set(kind, { ...row, key: createPrivateKey(row.pem), spec, kind });
  }
  async function send(agent, action) {
    const c = board.challenge({ ...action, address: agent.owner }, origin);
    return board.commit(
      {
        id: c.id,
        signature: sign(null, Buffer.from(c.message), agent.key).toString(
          "hex",
        ),
      },
      origin,
    );
  }
  let busy = false;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      for (const agent of catalog.values()) {
        if (!agent.service) {
          // Recover a listing if the process stopped between signing it and recording its ID.
          const existing = db
            .prepare(
              "SELECT id FROM services WHERE owner=? ORDER BY rowid LIMIT 1",
            )
            .get(agent.owner);
          agent.service =
            existing?.id ||
            (
              await send(agent, {
                kind: "service",
                ...agent.spec,
                active: true,
                verifyId: false,
                language: "both",
                version: 0,
              })
            ).service;
          db.prepare("UPDATE directory_tools SET service=? WHERE kind=?").run(
            agent.service,
            agent.kind,
          );
        }
        const jobs = db
          .prepare(
            "SELECT b.id,b.body FROM service_orders s JOIN briefs b ON b.id=s.brief LEFT JOIN entries e ON e.brief=b.id AND e.owner=s.provider LEFT JOIN rewards r ON r.brief=b.id WHERE s.provider=? AND json_extract(s.terms,'$.id')=? AND e.id IS NULL AND r.brief IS NULL AND b.selected IS NULL ORDER BY b.rowid LIMIT 12",
          )
          .all(agent.owner, agent.service);
        for (const b of jobs) {
          await send(agent, { kind: "accept", brief: b.id });
          await send(agent, {
            kind: "submit",
            brief: b.id,
            line: toolResult(agent.kind, b.body),
          });
        }
      }
    } finally {
      busy = false;
    }
  }
  const run = () =>
    tick().catch(() =>
      console.error("Directory tools will retry pending work"),
    );
  const ready = tick();
  ready.catch(() => console.error("Directory tools will retry startup"));
  const timer = setInterval(run, 3500);
  timer.unref();
  return { ready, tick, stop: () => clearInterval(timer) };
}
