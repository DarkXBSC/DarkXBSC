// Inventory is denominated in the pool asset. Only finalized USDT proceeds enter routes.received.
import {
  Contract,
  Interface,
  Transaction,
  ZeroAddress,
  formatUnits,
  getAddress,
  keccak256,
  parseUnits,
  zeroPadValue,
} from "ethers";
import { BSC_USDT } from "./binance-giving.mjs";
import { prepareRouteGas } from "./x-tax-gas.mjs";

export const WBNB = getAddress("0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c");
export const ROUTER = getAddress("0x10ED43C718714eb63d5aA57B78B54704E256024E");
const FACTORY = getAddress("0xca143ce32fe78f1f7019d7d551a6402fc5350c73");
const USDC = getAddress("0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d");
const erc = new Interface([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
  "function transfer(address to,uint256 amount) returns(bool)",
  "function approve(address,uint256) returns(bool)",
  "function allowance(address,address) view returns(uint256)",
]);
const router = new Interface([
  "function getAmountsOut(uint256,address[]) view returns(uint256[])",
  "function swapExactETHForTokens(uint256,address[],address,uint256) payable returns(uint256[])",
  "function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns(uint256[])",
]);
const dispatch = new Interface([
  "event FlapTaxProcessorWalletDistributed(address indexed wallet,uint16 bps,uint256 amount)",
]);
const topic = erc.getEvent("Transfer").topicHash;
const eq = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase() === b.toLowerCase();
const pad = (a) => zeroPadValue(a, 32);
const qty = (v, d) => {
  if (
    typeof v !== "string" ||
    !/^\d+(\.\d+)?$/.test(v) ||
    v.length > 80 ||
    parseUnits(v, d) <= 0n
  )
    throw Error("INVALID_AMOUNT");
  return parseUnits(v, d);
};
export function sumTransfers(logs, asset, from, to) {
  let total = 0n;
  for (const l of logs)
    if (eq(l.address, asset) && l.topics[0] === topic) {
      const e = erc.parseLog(l).args;
      if (eq(e.from, from) && eq(e.to, to)) total += e.value;
    }
  return total;
}
export async function sourceRevenue(
  p,
  r,
  asset,
  processor,
  fromBlock,
  toBlock,
  assetBlock = toBlock,
) {
  const token = await new Contract(
    processor,
    ["function getQuoteToken() view returns(address)"],
    p,
  ).getQuoteToken({ blockTag: assetBlock });
  if (!eq(token, asset === ZeroAddress ? WBNB : asset))
    throw Error("X_POOL_MISMATCH");
  if (asset !== ZeroAddress) {
    const logs = await p.getLogs({
      address: asset,
      topics: [topic, pad(processor), pad(r.address)],
      fromBlock,
      toBlock,
    });
    return sumTransfers(logs, asset, processor, r.address);
  }
  const logs = await p.getLogs({
    address: processor,
    topics: [
      dispatch.getEvent("FlapTaxProcessorWalletDistributed").topicHash,
      pad(r.address),
    ],
    fromBlock,
    toBlock,
  });
  return logs.reduce((sum, l) => {
    if (!eq(l.address, processor)) return sum;
    const e = dispatch.parseLog(l).args;
    return eq(e.wallet, r.address) ? sum + e.amount : sum;
  }, 0n);
}
export async function marketQuote(p, asset, amount) {
  const start = asset === ZeroAddress ? WBNB : asset;
  const paths = [
    [start, BSC_USDT],
    ...[WBNB, USDC]
      .filter((mid) => !eq(start, mid))
      .map((mid) => [start, mid, BSC_USDT]),
  ];
  const c = new Contract(ROUTER, router, p);
  const options = await Promise.all(
    paths.map(async (path) => {
      try {
        return { path, out: (await c.getAmountsOut(amount, path)).at(-1) };
      } catch {
        return null;
      }
    }),
  );
  const best = options
    .filter((q) => q && q.out > 0n)
    .sort((a, b) => (a.out > b.out ? -1 : 1))[0];
  if (!best) throw Error("X_NO_DEX_QUOTE");
  return best;
}
export function conversionBook(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS poolRevenue(route INTEGER PRIMARY KEY,asset TEXT NOT NULL,symbol TEXT NOT NULL,decimals INTEGER NOT NULL,startBlock INTEGER NOT NULL,earned TEXT NOT NULL DEFAULT '0',spent TEXT NOT NULL DEFAULT '0');
    CREATE TABLE IF NOT EXISTS conversions(id INTEGER PRIMARY KEY,route INTEGER NOT NULL,kind TEXT NOT NULL,amount TEXT NOT NULL,floor TEXT NOT NULL,stage TEXT NOT NULL,operator TEXT,deposit TEXT UNIQUE,path TEXT,pair TEXT,deadline INTEGER,raw TEXT,action TEXT,hash TEXT,actual TEXT,requestId TEXT UNIQUE);
    CREATE UNIQUE INDEX IF NOT EXISTS conversionInFlight ON conversions(route) WHERE stage IN ('queued','signed');`);
  const assetOf = (idx) =>
    db.prepare("SELECT * FROM poolRevenue WHERE route=?").get(idx);
  const active = (idx) =>
    db
      .prepare(
        "SELECT * FROM conversions WHERE route=? AND stage IN ('queued','signed')",
      )
      .get(idx);
  function register(idx, a, block) {
    db.prepare(
      "INSERT INTO poolRevenue(route,asset,symbol,decimals,startBlock) VALUES(?,?,?,?,?)",
    ).run(idx, a.address, a.symbol, a.decimals, block);
  }
  function inventory(idx) {
    const a = assetOf(idx);
    if (!a) return null;
    const job = active(idx),
      avail = BigInt(a.earned) - BigInt(a.spent);
    const last = db
      .prepare(
        "SELECT kind,stage,actual,hash,deposit FROM conversions WHERE route=? ORDER BY id DESC LIMIT 1",
      )
      .get(idx);
    return {
      asset: a.asset,
      symbol: a.symbol,
      decimals: a.decimals,
      earned: formatUnits(a.earned, a.decimals),
      remaining: formatUnits(avail, a.decimals),
      reserved: formatUnits(job?.amount || "0", a.decimals),
      stage: job
        ? "converting"
        : avail > 0n
          ? "awaiting-conversion"
          : "collecting",
      last: last
        ? { ...last, actual: last.actual ? formatUnits(last.actual, 18) : null }
        : null,
    };
  }
  function reserve(idx) {
    const a = assetOf(idx);
    return a?.asset === ZeroAddress ? BigInt(a.earned) - BigInt(a.spent) : 0n;
  }
  // This method is reachable only via the local operator CLI, never from HTTP.
  async function order({
    p,
    token,
    amount,
    minUSDT,
    deposit,
    operator,
    commit = false,
    requestId,
  }) {
    if ((await p.getNetwork()).chainId !== 56n) throw Error("X_CHAIN_MISMATCH");
    const r = db
      .prepare("SELECT idx,address,token FROM routes WHERE token=?")
      .get(getAddress(token));
    const a = r && assetOf(r.idx);
    if (!a) throw Error("UNKNOWN_CONVERSION_ROUTE");
    operator = getAddress(operator);
    const input = qty(amount, a.decimals),
      floor = qty(minUSDT, 18),
      kind = deposit ? "operator" : "dex";
    if (commit && !/^[A-Za-z0-9_-]{1,80}$/.test(requestId || ""))
      throw Error("REQUEST_ID_REQUIRED");
    const prior =
      requestId &&
      db.prepare("SELECT * FROM conversions WHERE requestId=?").get(requestId);
    if (prior) {
      if (
        prior.route !== r.idx ||
        prior.kind !== kind ||
        prior.amount !== String(input) ||
        prior.floor !== String(floor) ||
        prior.deposit !== (deposit?.toLowerCase() || null)
      )
        throw Error("REQUEST_ID_CONFLICT");
      return { id: prior.id, stage: prior.stage };
    }
    if (input > BigInt(a.earned) - BigInt(a.spent) || active(r.idx))
      throw Error("INSUFFICIENT_UNRESERVED_TAX");
    let path = null,
      pair = null,
      out;
    const head = await p.getBlock("finalized");
    if (deposit) {
      if (!/^0x[0-9a-f]{64}$/i.test(deposit)) throw Error("INVALID_DEPOSIT");
      const [rc, tx] = await Promise.all([
        p.getTransactionReceipt(deposit),
        p.getTransaction(deposit),
      ]);
      if (
        !rc ||
        !tx ||
        rc.status !== 1 ||
        rc.blockNumber > head.number ||
        rc.blockNumber <= a.startBlock ||
        !eq(rc.from, operator) ||
        !eq(tx.to, BSC_USDT) ||
        !eq(tx.from, operator)
      )
        throw Error("INVALID_DEPOSIT");
      const args = erc.decodeFunctionData("transfer", tx.data);
      out = sumTransfers(rc.logs, BSC_USDT, operator, r.address);
      if (!eq(args[0], r.address) || args[1] !== floor || out !== floor)
        throw Error("INVALID_DEPOSIT");
    } else {
      ({ path, out } = await marketQuote(p, a.asset, input));
      if (out < floor) throw Error("X_CONVERSION_PRICE");
      pair = await new Contract(
        FACTORY,
        ["function getPair(address,address) view returns(address)"],
        p,
      ).getPair(path.at(-2), BSC_USDT);
      if (pair === ZeroAddress) throw Error("X_NO_DEX_QUOTE");
    }
    const info = {
      token: r.token,
      collection: r.address,
      asset: a.symbol,
      amount,
      usdt: formatUnits(out, 18),
      minUSDT,
      kind,
      operator,
    };
    if (!commit) return info;
    db.exec("BEGIN IMMEDIATE");
    try {
      const fresh = assetOf(r.idx);
      if (input > BigInt(fresh.earned) - BigInt(fresh.spent) || active(r.idx))
        throw Error("INSUFFICIENT_UNRESERVED_TAX");
      const saved = db
        .prepare(
          "INSERT INTO conversions(route,kind,amount,floor,stage,operator,deposit,path,pair,deadline,requestId) VALUES(?,?,?,?,'queued',?,?,?,?,?,?)",
        )
        .run(
          r.idx,
          kind,
          String(input),
          String(floor),
          operator,
          deposit?.toLowerCase() || null,
          path ? JSON.stringify(path) : null,
          pair,
          head.timestamp + 1800,
          requestId,
        );
      db.exec("COMMIT");
      return { ...info, id: Number(saved.lastInsertRowid), stage: "queued" };
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return { assetOf, register, active, inventory, reserve, order };
}
export async function processConversion({ db, book, r, p, wallet, sponsor }) {
  const j = book.active(r.idx);
  if (!j) return false;
  const a = book.assetOf(r.idx),
    input = BigInt(j.amount),
    floor = BigInt(j.floor),
    native = a.asset === ZeroAddress;
  if (!sponsor) throw Error("X_GAS_REQUIRED");
  const head = await p.getBlock("finalized");
  const finish = (stage) =>
    db
      .prepare("UPDATE conversions SET stage=?,raw=NULL WHERE id=? AND stage=?")
      .run(stage, j.id, j.stage);
  if (j.stage === "queued") {
    if (j.kind === "dex" && head.timestamp >= j.deadline) {
      finish("expired");
      return true;
    }
    let tx, action;
    if (j.kind === "operator") {
      action = "release";
      tx = native
        ? { to: j.operator, value: input, data: "0x" }
        : {
            to: a.asset,
            data: erc.encodeFunctionData("transfer", [j.operator, input]),
          };
    } else {
      const path = JSON.parse(j.path);
      const limit = native
        ? 0n
        : await new Contract(a.asset, erc, p).allowance(r.address, ROUTER);
      if (!native && limit !== input) {
        action = limit === 0n ? "approve" : "reset";
        tx = {
          to: a.asset,
          data: erc.encodeFunctionData("approve", [
            ROUTER,
            limit === 0n ? input : 0n,
          ]),
        };
      } else {
        const amounts = await new Contract(ROUTER, router, p).getAmountsOut(
          input,
          path,
        );
        if (amounts.at(-1) < floor) throw Error("X_CONVERSION_PRICE");
        action = "swap";
        tx = native
          ? {
              to: ROUTER,
              value: input,
              data: router.encodeFunctionData("swapExactETHForTokens", [
                floor,
                path,
                r.address,
                j.deadline,
              ]),
            }
          : {
              to: ROUTER,
              data: router.encodeFunctionData("swapExactTokensForTokens", [
                input,
                floor,
                path,
                r.address,
                j.deadline,
              ]),
            };
      }
    }
    const signed = await wallet.signTransaction(
      await prepareRouteGas(p, 56, r.address, tx),
    );
    db.prepare(
      "UPDATE conversions SET raw=?,hash=?,action=?,stage='signed' WHERE id=? AND stage='queued' AND NOT EXISTS(SELECT 1 FROM batches WHERE route=? AND stage IN ('source-deposit','bridge'))",
    ).run(signed, keccak256(signed), action, j.id, r.idx);
    return true;
  }
  const tx = Transaction.from(j.raw);
  if (
    keccak256(j.raw) !== j.hash ||
    !eq(tx.from, r.address) ||
    tx.chainId !== 56n
  )
    throw Error("X_CONVERSION_REVIEW");
  const rc = await p.getTransactionReceipt(j.hash);
  if (!rc) {
    if (await p.getTransaction(j.hash)) return true;
    if ((await p.getTransactionCount(r.address, "finalized")) > tx.nonce)
      throw Error("X_CONVERSION_REVIEW");
    if (j.kind === "dex" && head.timestamp >= j.deadline) {
      finish("expired");
      return true;
    }
    await sponsor.ensure(56, r.idx, j.raw);
    await p.broadcastTransaction(j.raw);
    return true;
  }
  if (rc.blockNumber > head.number) return true;
  if (rc.status !== 1) {
    if (j.kind === "operator") {
      throw Error("X_CONVERSION_REVIEW");
    }
    finish("reverted");
    return true;
  }
  if (!eq(rc.from, r.address) || !eq(rc.to, tx.to))
    throw Error("X_CONVERSION_REVIEW");
  if (j.action === "approve" || j.action === "reset") {
    const allowance = await new Contract(a.asset, erc, p).allowance(
      r.address,
      ROUTER,
      { blockTag: rc.blockNumber },
    );
    if (allowance !== (j.action === "approve" ? input : 0n))
      throw Error("X_CONVERSION_REVIEW");
    db.prepare(
      "UPDATE conversions SET stage='queued',raw=NULL WHERE id=? AND hash=?",
    ).run(j.id, j.hash);
    return true;
  }
  let actual = floor;
  if (j.kind === "dex") {
    actual = sumTransfers(rc.logs, BSC_USDT, j.pair, r.address);
    if (actual < floor || !eq(tx.to, ROUTER))
      throw Error("X_CONVERSION_REVIEW");
  } else if (
    native
      ? !eq(tx.to, j.operator) || tx.value !== input
      : sumTransfers(rc.logs, a.asset, r.address, j.operator) !== input
  )
    throw Error("X_CONVERSION_REVIEW");
  db.exec("BEGIN IMMEDIATE");
  try {
    const saved = db
      .prepare(
        "UPDATE conversions SET stage='complete',raw=NULL,actual=? WHERE id=? AND stage='signed' AND hash=?",
      )
      .run(String(actual), j.id, j.hash);
    if (saved.changes) {
      const fresh = book.assetOf(r.idx),
        route = db
          .prepare("SELECT received FROM routes WHERE idx=?")
          .get(r.idx);
      const spent = BigInt(fresh.spent) + input;
      if (spent > BigInt(fresh.earned)) throw Error("X_CONVERSION_REVIEW");
      db.prepare("UPDATE poolRevenue SET spent=? WHERE route=?").run(
        String(spent),
        r.idx,
      );
      db.prepare("UPDATE routes SET received=? WHERE idx=?").run(
        String(BigInt(route.received) + actual),
        r.idx,
      );
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return true;
}
