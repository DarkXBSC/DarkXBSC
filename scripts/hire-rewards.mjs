import { readFileSync } from "node:fs";
import {
  Contract,
  Interface,
  ZeroAddress,
  formatUnits,
  getAddress,
  id,
  isAddress,
  parseUnits,
} from "ethers";
import { bscProvider } from "./config.mjs";

const json = (name) =>
  JSON.parse(readFileSync("public/contracts/" + name + ".json"));
const quoteABI = [
  "function decimals() view returns(uint8)",
  "function symbol() view returns(string)",
];
const entryTypes = {
  CommissionEntry: [
    { name: "brief", type: "bytes32" },
    { name: "author", type: "address" },
    { name: "caption", type: "string" },
  ],
};
export function entryMessage(reward, author, caption) {
  return {
    domain: {
      name: "Dark Paid Work",
      version: "1",
      chainId: 56,
      verifyingContract: reward.vault,
    },
    types: entryTypes,
    value: { brief: reward.key, author, caption },
  };
}
export function rewardTerms(raw) {
  if (
    !raw ||
    !isAddress(raw.token) ||
    getAddress(raw.token) === ZeroAddress ||
    typeof raw.amount !== "string" ||
    !/^(?:0|[1-9]\d{0,36})(?:\.\d{1,36})?$/.test(raw.amount) ||
    !/[1-9]/.test(raw.amount)
  )
    throw Error("REWARD_TERMS");
  return { token: getAddress(raw.token), amount: raw.amount };
}
export function rewardReader(env, chainProvider) {
  const meta = json("commission"),
    abi = json("TigerCommissionVault.abi"),
    iface = new Interface(abi);
  let provider = chainProvider;
  async function get() {
    provider ??= bscProvider(env).catch((e) => {
      provider = null;
      throw e;
    });
    return provider;
  }
  async function snapshot() {
    const p = await get();
    const block = await p.send("eth_getBlockByNumber", ["finalized", false]);
    if (!block?.number) throw Error("REWARD_RPC");
    return { p, at: { blockTag: Number(BigInt(block.number)) } };
  }
  return {
    async info(token) {
      if (!isAddress(token)) throw Error("REWARD_TOKEN");
      const { p, at } = await snapshot(),
        factory = new Contract(
          meta.address,
          ["function vaultOf(address) view returns(address)"],
          p,
        );
      if ((await p.getCode(meta.address, at.blockTag)) === "0x")
        throw Error("REWARD_FACTORY");
      const address = await factory.vaultOf(token, at);
      if (address === ZeroAddress) throw Error("REWARD_TOKEN");
      const vault = new Contract(address, abi, p);
      const [actual, owner, asset, share, balances] = await Promise.all([
        vault.token(at),
        vault.issuer(at),
        vault.asset(at),
        vault.shareBps(at),
        vault.available(at),
      ]);
      if (getAddress(actual) !== getAddress(token)) throw Error("REWARD_TOKEN");
      const q = asset !== ZeroAddress ? new Contract(asset, quoteABI, p) : null;
      const [decimals, symbol] = q
        ? await Promise.all([q.decimals(at), q.symbol(at)])
        : [18, "BNB"];
      return {
        vault: address,
        token: getAddress(token),
        owner,
        asset,
        decimals: Number(decimals),
        symbol,
        share: Number(share),
        available: balances[0].toString(),
        creator: balances[1].toString(),
      };
    },
    async status(r) {
      const { p, at } = await snapshot(),
        vault = new Contract(r.vault, abi, p);
      const b = await vault.budgets(r.key, at);
      if (!b.amount) return { state: "funding" };
      if (b.amount.toString() !== r.amount || Number(b.deadline) !== r.deadline)
        return { state: "conflict" };
      if (!b.settledBlock) return { state: "open" };
      const expired = b.author === ZeroAddress,
        event = expired ? "Released" : "Awarded",
        block = Number(b.settledBlock);
      const logs = await p.getLogs({
        address: r.vault,
        topics: [iface.getEvent(event).topicHash, r.key],
        fromBlock: block,
        toBlock: block,
      });
      if (logs.length !== 1) throw Error("REWARD_RPC");
      return {
        state: expired ? "released" : "paid",
        author: b.author,
        work: b.captionHash,
        hash: logs[0].transactionHash,
      };
    },
  };
}
export function createRewardStore(db, reader, now = Date.now) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS rewards(brief TEXT PRIMARY KEY,terms TEXT NOT NULL,state TEXT NOT NULL,tx TEXT,checked INTEGER NOT NULL DEFAULT 0);CREATE INDEX IF NOT EXISTS reward_queue ON rewards(state,checked);CREATE TABLE IF NOT EXISTS entry_proofs(entry TEXT PRIMARY KEY,signature TEXT NOT NULL)",
  );
  const abi = new Interface([
    "function open(bytes32,uint256,uint64)",
    "function award(bytes32,address,string,bytes)",
    "function expire(bytes32)",
  ]);
  function get(brief) {
    const row = db.prepare("SELECT * FROM rewards WHERE brief=?").get(brief);
    return row
      ? { ...JSON.parse(row.terms), state: row.state, tx: row.tx }
      : null;
  }
  async function plan(terms, owner, brief) {
    const info = await reader.info(terms.token);
    if (getAddress(info.owner) !== owner) throw Error("HIRE_OWNER");
    let amount;
    try {
      amount = parseUnits(terms.amount, info.decimals);
    } catch {
      throw Error("REWARD_TERMS");
    }
    if (amount <= 0n || amount >= 2n ** 256n) throw Error("REWARD_TERMS");
    if (amount > BigInt(info.available)) throw Error("REWARD_BALANCE");
    return {
      brief,
      key: id(brief),
      vault: info.vault,
      token: info.token,
      owner,
      asset: info.asset,
      symbol: info.symbol,
      amount: amount.toString(),
      display: formatUnits(amount, info.decimals),
      deadline: Math.floor(now() / 1000) + 30 * 86400,
    };
  }
  const locks = new Map();
  async function sync(brief) {
    if (locks.has(brief)) return locks.get(brief);
    const run = (async () => {
      const r = get(brief);
      if (!r || !["open", "funding"].includes(r.state)) return r;
      db.prepare("UPDATE rewards SET checked=? WHERE brief=?").run(
        now(),
        brief,
      );
      const s = await reader.status(r);
      let selected;
      if (s.state === "paid") {
        const e = db
          .prepare("SELECT id,line FROM entries WHERE brief=? AND owner=?")
          .get(brief, getAddress(s.author));
        if (e && id(e.line) === s.work) selected = e.id;
      }
      db.exec("BEGIN IMMEDIATE");
      try {
        if (selected)
          db.prepare("UPDATE briefs SET selected=? WHERE id=?").run(
            selected,
            brief,
          );
        db.prepare("UPDATE rewards SET state=?,tx=? WHERE brief=?").run(
          s.state,
          s.hash || null,
          brief,
        );
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      return get(brief);
    })().finally(() => locks.delete(brief));
    locks.set(brief, run);
    return run;
  }
  function action(brief, kind, entry) {
    const r = get(brief);
    if (!r) throw Error("HIRE_MISSING");
    if (kind === "fund" && r.state === "funding" && r.deadline > now() / 1000)
      return {
        to: r.vault,
        data: abi.encodeFunctionData("open", [r.key, r.amount, r.deadline]),
      };
    if (kind === "expire" && r.state === "open" && r.deadline <= now() / 1000)
      return { to: r.vault, data: abi.encodeFunctionData("expire", [r.key]) };
    if (kind === "award" && r.state === "open" && r.deadline > now() / 1000) {
      const e = db
        .prepare(
          "SELECT e.owner,e.line,p.signature FROM entries e JOIN entry_proofs p ON p.entry=e.id WHERE e.brief=? AND e.id=?",
        )
        .get(brief, entry);
      if (!e) throw Error("HIRE_MISSING");
      return {
        to: r.vault,
        data: abi.encodeFunctionData("award", [
          r.key,
          e.owner,
          e.line,
          e.signature,
        ]),
        author: e.owner,
        line: e.line,
      };
    }
    throw Error("REWARD_STATE");
  }
  return {
    get,
    plan,
    sync,
    action,
    info: (token) => reader.info(token),
    save(brief, terms) {
      db.prepare(
        "INSERT INTO rewards(brief,terms,state) VALUES(?,?,'funding')",
      ).run(brief, JSON.stringify(terms));
    },
    proof(entry, signature) {
      db.prepare("INSERT OR IGNORE INTO entry_proofs VALUES(?,?)").run(
        entry,
        signature,
      );
    },
    requireOpen(brief) {
      const r = get(brief);
      if (r && (r.state !== "open" || r.deadline <= now() / 1000))
        throw Error("REWARD_STATE");
      return r;
    },
    async tick() {
      const rows = db
        .prepare(
          "SELECT brief FROM rewards WHERE state IN ('open','funding') AND checked<? AND (state='open' OR json_extract(terms,'$.deadline')>?) ORDER BY checked LIMIT 8",
        )
        .all(now() - 15000, Math.floor(now() / 1000));
      await Promise.allSettled(rows.map((r) => sync(r.brief)));
    },
  };
}
