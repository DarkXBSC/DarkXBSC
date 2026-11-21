// Each launch has a separate BSC collection wallet and settlement journal.
import {
  conversionBook,
  processConversion,
  sourceRevenue,
} from "./x-tax-conversions.mjs";
import { launchDisclosure } from "./launch-disclosure.mjs";
import { createNominationBook } from "./giving-nominations.mjs";
import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  createHmac,
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import {
  Contract,
  HDNodeWallet,
  Interface,
  JsonRpcProvider,
  getAddress,
  getCreate2Address,
  keccak256,
  parseUnits,
  formatUnits,
  zeroPadValue,
} from "ethers";
import { createCashClient } from "@zkp2p/cash";
import { createWalletClient, http, nonceManager } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";
import {
  FX_API,
  ONE_CLICK_API,
  publicXProfile,
  nearQuote,
  nearStatus,
  nearDepositDeadline,
  signNearDeposit,
} from "./x-public-providers.mjs";
import { createGasSponsor, prepareRouteGas } from "./x-tax-gas.mjs";
import { BSC_USDT } from "./binance-giving.mjs";
import { USDC, validatePlan } from "./peer-pay.mjs";

const flap = JSON.parse(
  readFileSync(new URL("../public/protocols.json", import.meta.url)),
).flap;
const clone =
  "0x363d3d373d3d3d363d73" +
  flap.taxImplementation.slice(2).toLowerCase() +
  "5af43d82803e903d91602b57fd5bf3";
const initHash = keccak256("0x3d602d80600a3d3981f3" + clone.slice(2));
const transfer = new Interface([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
const transferTopic = transfer.getEvent("Transfer").topicHash;
export const predictTaxToken = (salt) =>
  getCreate2Address(flap.portal, salt, initHash);
const lower = (s) => String(s).toLowerCase();
const eq = (a, b) => lower(a) === lower(b);
function positiveUnits(s, decimals) {
  if (!/^\d{1,6}(\.\d{1,6})?$/.test(s ?? "")) throw Error("X_TAX_LIMITS");
  const v = parseUnits(s, decimals);
  if (v <= 0n) throw Error("X_TAX_LIMITS");
  return v;
}
export function verifiedFiat(order, payeeHash) {
  if (
    order.payouts?.length !== 1 ||
    !order.payouts.some(
      (p) =>
        p.platform === "xmoney" &&
        p.currency === "USD" &&
        eq(p.payeeHash, payeeHash),
    )
  )
    throw Error("X_ORDER_MISMATCH");
  let cents = 0n,
    released = 0n;
  const seen = new Set();
  for (const f of order.fills) {
    if (
      f.status !== "FULFILLED" ||
      f.paidCurrency !== "USD" ||
      !f.paymentId ||
      seen.has(f.paymentId) ||
      !(f.releasedAmount > 0n) ||
      !Number.isFinite(f.fiatPaid) ||
      f.fiatPaid <= 0
    )
      continue;
    const n = Math.round(f.fiatPaid * 100);
    if (!Number.isSafeInteger(n) || Math.abs(n - f.fiatPaid * 100) > 0.00001)
      continue;
    seen.add(f.paymentId);
    cents += BigInt(n);
    released += f.releasedAmount;
  }
  return { cents, released };
}
function transferSum(logs, asset, from, to) {
  return logs.reduce((sum, log) => {
    if (!eq(log.address, asset) || log.topics[0] !== transferTopic) return sum;
    const args = transfer.parseLog(log).args;
    return (!from || eq(from, args.from)) && (!to || eq(to, args.to))
      ? sum + args.value
      : sum;
  }, 0n);
}
async function lookupX(handle, bearer) {
  const res = await fetch("https://api.x.com/2/users/by/username/" + handle, {
    headers: { Authorization: "Bearer " + bearer },
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw Error("X_LOOKUP_UNAVAILABLE");
  const { data } = await res.json();
  if (!/^\d{1,24}$/.test(data?.id || "") || !eq(data.username, handle))
    throw Error("X_ACCOUNT_UNVERIFIED");
  return data.id;
}
export function createXTaxGiving(env, deps = {}) {
  const useFx = env.X_TAX_IDENTITY_API === FX_API,
    useNear = env.X_TAX_BRIDGE_API === ONE_CLICK_API;
  if (
    !env.X_TAX_SEED ||
    (!useFx && !env.X_API_BEARER_TOKEN) ||
    (!useNear && !env.RELAY_API_KEY)
  )
    return { enabled: false };
  const enabled = env.X_TAX_ENABLE === "yes" && !!env.X_TAX_MAX_USDT;
  if (!/^[0-9a-f]{64}$/i.test(env.X_TAX_SEED))
    throw Error("X_TAX_SEED_INVALID");
  const minimum = positiveUnits(env.X_TAX_MIN_USDT || "25", 18),
    cap = env.X_TAX_MAX_USDT ? positiveUnits(env.X_TAX_MAX_USDT, 18) : minimum;
  if (minimum > cap) throw Error("X_TAX_LIMITS");
  const root = HDNodeWallet.fromSeed("0x" + env.X_TAX_SEED);
  const secret = Buffer.from(env.X_TAX_SEED, "hex");
  const mac = (domain, data) =>
    createHmac("sha256", secret)
      .update(domain + "\0" + data)
      .digest();
  const aes = mac("encryption", "x-tax-v1");
  const seal = (obj) => {
    const iv = randomBytes(12),
      c = createCipheriv("aes-256-gcm", aes, iv);
    const bytes = Buffer.concat([
      c.update(JSON.stringify(obj), "utf8"),
      c.final(),
    ]);
    return Buffer.concat([iv, c.getAuthTag(), bytes]).toString("base64");
  };
  const open = (data) => {
    const bytes = Buffer.from(data, "base64"),
      c = createDecipheriv("aes-256-gcm", aes, bytes.subarray(0, 12));
    c.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([c.update(bytes.subarray(28)), c.final()]).toString(),
    );
  };
  const sourceRpcUrl =
    env.X_TAX_BSC_RPC_URL || "https://bsc-rpc.publicnode.com";
  const bscRpc = deps.bsc || new JsonRpcProvider(sourceRpcUrl, 56);
  const baseRpc =
    deps.base ||
    new JsonRpcProvider(env.BASE_RPC_URL || "https://mainnet.base.org", 8453);
  const cash =
    deps.cash ||
    createCashClient({
      environment: "production",
      relay: { apiKey: env.RELAY_API_KEY },
      nearIntents: { apiUrl: ONE_CLICK_API },
    });
  const resolve =
    deps.resolve ||
    (useFx ? publicXProfile : (h) => lookupX(h, env.X_API_BEARER_TOKEN));
  const dir = deps.dir || "deployments/private/x-tax";
  const database = join(dir, "routes.sqlite");
  if (deps.sharedLedger) {
    // Both service users need SQLite journal access. A missing migrated ledger
    // must never silently allocate a new sequence of collection wallets.
    if (
      (statSync(dir).mode & 0o7777) !== 0o2770 ||
      (statSync(database).mode & 0o777) !== 0o660
    )
      throw Error("X_LEDGER_PERMISSIONS");
  } else {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const db = new DatabaseSync(database);
  if (!deps.sharedLedger) chmodSync(database, 0o600);
  db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS config(fp TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS routes(idx INTEGER PRIMARY KEY,token TEXT UNIQUE,address TEXT UNIQUE,identity TEXT,ticket TEXT,lastBlock INTEGER,received TEXT DEFAULT '0',issue TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS bridgeEvidence(request TEXT PRIMARY KEY, evidence TEXT);
    CREATE TABLE IF NOT EXISTS batches(id INTEGER PRIMARY KEY,route INTEGER,input TEXT,stage TEXT,request TEXT UNIQUE,expected TEXT,output TEXT,plan TEXT,payeeHash TEXT,raw TEXT,deposit TEXT UNIQUE,cents TEXT DEFAULT '0');`);
  const fp = mac("fingerprint", "x-tax-v1").toString("hex");
  db.prepare(
    "INSERT INTO config SELECT ? WHERE NOT EXISTS(SELECT 1 FROM config)",
  ).run(fp);
  if (!db.prepare("SELECT fp FROM config WHERE fp=?").get(fp))
    throw Error("X_TAX_SEED_CHANGED");
  function atomic(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      db.exec("COMMIT");
      return r;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  const wallet = (i) => root.derivePath("m/44'/60'/0'/0/" + i);
  const conversions = conversionBook(db);
  let poolCache,
    poolTime = 0;
  async function poolAsset(raw) {
    const address = getAddress(raw);
    if (eq(address, BSC_USDT))
      return { address: BSC_USDT, symbol: "USDT", decimals: 18 };
    if (env.X_TAX_GAS_SPONSOR !== "deployer")
      throw Error("X_POOL_CONVERSION_UNAVAILABLE");
    if (deps.poolAsset) return deps.poolAsset(address);
    if (!poolCache || Date.now() - poolTime > 60000) {
      const res = await fetch("https://flap.sh/api/launch/quote-tokens", {
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) throw Error("X_POOL_UNAVAILABLE");
      poolCache = (await res.json()).chains.find(
        (c) => c.chainId === 56,
      )?.quoteTokens;
      poolTime = Date.now();
    }
    const found = poolCache?.find((a) => eq(address, a.address));
    if (
      !found ||
      !Number.isInteger(found.decimals) ||
      found.decimals < 0 ||
      found.decimals > 77
    )
      throw Error("X_POOL_UNAVAILABLE");
    return { address, symbol: found.symbol, decimals: found.decimals };
  }
  const sponsor = deps.gasKey
    ? createGasSponsor({
        db,
        key: deps.gasKey,
        providers: { 56: bscRpc, 8453: baseRpc },
        routeAddress: (idx) => {
          const address = wallet(idx).address;
          if (
            db.prepare("SELECT address FROM routes WHERE idx=?").get(idx)
              ?.address !== address
          )
            throw Error("X_GAS_REVIEW");
          return address;
        },
        reservedNative: conversions.reserve,
        authorizedNative: (idx, raw) => conversions.active(idx)?.raw === raw,
        limits: {
          56: parseUnits(env.X_TAX_GAS_LIMIT_BNB || "0.0001", 18),
          8453: parseUnits(env.X_TAX_GAS_LIMIT_ETH || "0.0001", 18),
        },
      })
    : null;
  if (sponsor && !useNear) throw Error("X_GAS_BRIDGE_UNSUPPORTED");
  function norm(raw) {
    const h = String(raw ?? "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
    if (!/^[a-z0-9_]{1,15}$/.test(h)) throw Error("INVALID_X_HANDLE");
    return h;
  }
  async function identity(raw) {
    const handle = norm(raw);
    const resolved = await resolve(handle);
    const id = typeof resolved === "string" ? resolved : resolved?.id;
    if (typeof id !== "string" || !/^\d{1,24}$/.test(id))
      throw Error("X_ACCOUNT_UNVERIFIED");
    return { handle, id, ...(typeof resolved === "object" ? { name: resolved.name, avatar: resolved.avatar } : {}) };
  }
  const ticketFor = (v) =>
    mac("identity", JSON.stringify([v.handle, v.id])).toString("hex");
  async function liveQuote(address, amount, dry = true) {
    if (useNear) {
      try {
        return await nearQuote(cash, address, amount, dry);
      } catch {
        throw Error("X_QUOTE_UNAVAILABLE");
      }
    }
    const quote = await cash
      .quoteSource({
        source: { chainId: 56, currency: BSC_USDT },
        user: address,
        recipient: address,
        amount,
        tradeType: "EXACT_INPUT",
      })
      .catch(() => {
        throw Error("X_QUOTE_UNAVAILABLE");
      });
    if (
      !quote.requestId ||
      quote.inputAmount !== amount ||
      quote.source.chainId !== 56 ||
      !eq(quote.source.address, BSC_USDT) ||
      quote.destination.chainId !== 8453 ||
      !eq(quote.destination.address, USDC) ||
      quote.outputAmount * 10n ** 12n * 100n < amount * 98n
    )
      throw Error("X_QUOTE_UNAVAILABLE");
    return quote;
  }
  const nominations = createNominationBook({ db, seal, open, identity, mac });
  const scopedTicket = (v, nomination) =>
    nomination
      ? mac("nomination-ticket", nomination + ":" + ticketFor(v)).toString(
          "hex",
        )
      : ticketFor(v);
  function disclosureTicket(v, nomination, disclosure) {
    const base = scopedTicket(v, nomination);
    return disclosure ? mac("launch-disclosure", base + ":" + JSON.stringify(disclosure)).toString("hex") : base;
  }
  async function check(raw, nomination, options) {
    const v = nomination
      ? await nominations.resolve(nomination)
      : await identity(raw);
    const disclosure = launchDisclosure(options, v.handle, nomination);
    const q = await liveQuote(wallet(2147483646).address, minimum);
    return {
      state: enabled ? "READY" : "VERIFIED",
      ...(enabled ? { ticket: disclosureTicket(v, nomination, disclosure) } : {}),
      ...(!nomination ? { recipient: { handle: v.handle, profile: "https://x.com/" + v.handle, name: v.name, avatar: v.avatar } } : {}),
      ...(disclosure ? { disclosure } : {}),
      quote: {
        inputUSDT: formatUnits(minimum, 18),
        minimumUSDC: formatUnits(q.outputAmount, 6),
      },
    };
  }
  async function bind({
    recipient,
    nomination,
    ticket,
    salt,
    confirmed,
    quote = BSC_USDT,
    disclosure: options,
  }) {
    if (!enabled) throw Error("X_TAX_UNAVAILABLE");
    const v = nomination
      ? await nominations.resolve(nomination)
      : await identity(recipient);
    const disclosure = launchDisclosure(options, v.handle, nomination);
    if (confirmed !== true || ticket !== disclosureTicket(v, nomination, disclosure))
      throw Error("RECIPIENT_CHANGED");
    const asset = await poolAsset(quote);
    const token = predictTaxToken(salt);
    const prev = db.prepare("SELECT * FROM routes WHERE token=?").get(token);
    const block =
      prev?.lastBlock ?? (await bscRpc.getBlock("finalized")).number;
    const row = atomic(() => {
      const existing = db
        .prepare("SELECT * FROM routes WHERE token=?")
        .get(token);
      if (existing) {
        if (
          existing.ticket !== ticket ||
          !eq(
            conversions.assetOf(existing.idx)?.asset ?? BSC_USDT,
            asset.address,
          )
        )
          throw Error("RECIPIENT_CHANGED");
        return existing;
      }
      const idx = Number(
        db.prepare("SELECT COALESCE(MAX(idx),-1)+1 AS n FROM routes").get().n,
      );
      const address = wallet(idx).address;
      db.prepare(
        "INSERT INTO routes(idx,token,address,identity,ticket,lastBlock) VALUES(?,?,?,?,?,?)",
      ).run(idx, token, address, seal({ ...v, disclosure }), ticket, block);
      if (!eq(asset.address, BSC_USDT)) conversions.register(idx, asset, block);
      if (nomination)
        db.prepare(
          "INSERT INTO nominationRoutes(token,nomination) VALUES(?,?)",
        ).run(token, nomination);
      return { address };
    });
    return {
      ticket,
      address: row.address,
      token,
      asset: asset.address,
      chainId: 56,
      rail: "xmoney-tax",
    };
  }
  async function scan(r, finalized) {
    if (finalized <= r.lastBlock) return;
    const code = lower(await bscRpc.getCode(r.token, finalized));
    if (code === "0x") {
      db.prepare(
        "UPDATE routes SET lastBlock=? WHERE idx=? AND lastBlock=?",
      ).run(finalized, r.idx, r.lastBlock);
      return;
    }
    if (code !== clone) throw Error("X_POOL_MISMATCH");
    const processor = deps.processor
      ? await deps.processor(r.token)
      : await new Contract(
          r.token,
          ["function taxProcessor() view returns(address)"],
          bscRpc,
        ).taxProcessor({ blockTag: finalized });
    const to = Math.min(finalized, r.lastBlock + 1500);
    const asset = conversions.assetOf(r.idx);
    if (asset) {
      const earned = await sourceRevenue(
        bscRpc,
        r,
        asset.asset,
        processor,
        r.lastBlock + 1,
        to,
        finalized,
      );
      atomic(() => {
        const claim = db
          .prepare("UPDATE routes SET lastBlock=? WHERE idx=? AND lastBlock=?")
          .run(to, r.idx, r.lastBlock);
        if (claim.changes && earned > 0n)
          db.prepare("UPDATE poolRevenue SET earned=? WHERE route=?").run(
            String(BigInt(conversions.assetOf(r.idx).earned) + earned),
            r.idx,
          );
      });
      return;
    }
    const logs = await bscRpc.getLogs({
      address: BSC_USDT,
      topics: [
        transferTopic,
        zeroPadValue(processor, 32),
        zeroPadValue(r.address, 32),
      ],
      fromBlock: r.lastBlock + 1,
      toBlock: to,
    });
    const earned = transferSum(logs, BSC_USDT, processor, r.address);
    db.prepare(
      "UPDATE routes SET lastBlock=?,received=? WHERE idx=? AND lastBlock=?",
    ).run(to, String(BigInt(r.received) + earned), r.idx, r.lastBlock);
  }
  async function confirmedDestination(batch, address) {
    const evidence = db
      .prepare("SELECT evidence FROM bridgeEvidence WHERE request=?")
      .get(batch.request);
    const requestId = evidence
      ? JSON.parse(evidence.evidence).requestId
      : batch.request;
    const record = evidence && JSON.parse(evidence.evidence);
    const s = record?.near
      ? await nearStatus(cash, record)
      : await cash.relayStatus(requestId);
    if (s.status === "failure" || s.status === "refund")
      throw Error("X_BRIDGE_REVIEW");
    if (
      s.status !== "success" ||
      s.requestId !== requestId ||
      (s.originChainId && s.originChainId !== 56) ||
      (s.destinationChainId && s.destinationChainId !== 8453)
    )
      return;
    async function confirmedSum(provider, hashes, asset, from, to) {
      let result = 0n;
      const end = (await provider.getBlock("finalized")).number;
      for (const hash of new Set(hashes)) {
        const receipt = await provider.getTransactionReceipt(hash);
        if (!receipt || receipt.status !== 1 || receipt.blockNumber > end)
          return 0n;
        if (from && !eq(receipt.from, from)) continue;
        result += transferSum(receipt.logs, asset, from, to);
      }
      return result;
    }
    const [spent, got] = await Promise.all([
      confirmedSum(
        bscRpc,
        s.inTxHashes,
        BSC_USDT,
        address,
        record?.near?.depositAddress || null,
      ),
      confirmedSum(baseRpc, s.txHashes, USDC, null, address),
    ]);
    if (
      spent !== BigInt(batch.input) ||
      (record?.near && got !== s.settledAmount) ||
      got < BigInt(batch.expected) ||
      got <= 0n
    )
      return;
    db.prepare(
      "UPDATE batches SET stage='base',output=? WHERE id=? AND stage='bridge'",
    ).run(String(got), batch.id);
  }
  function issue(idx, code) {
    db.prepare("UPDATE routes SET issue=? WHERE idx=?").run(code, idx);
  }
  async function sameIdentity(r) {
    const v = open(r.identity);
    if ((await identity(v.handle)).id !== v.id) throw Error("X_ACCOUNT_CHANGED");
    return v;
  }
  async function runRoute(r) {
    const b = db
      .prepare(
        "SELECT * FROM batches WHERE route=? AND stage!='paid' ORDER BY id LIMIT 1",
      )
      .get(r.idx);
    if (!b) {
      const used = db
        .prepare("SELECT input FROM batches WHERE route=?")
        .all(r.idx)
        .reduce((s, v) => s + BigInt(v.input), 0n);
      const available = BigInt(r.received) - used;
      if (available < minimum) return;
      const amount = available < cap ? available : cap;
      await sameIdentity(r);
      if (sponsor) {
        await sponsor.resume(56, r.idx);
      } else if (
        (await bscRpc.getBalance(r.address)) === 0n ||
        (await baseRpc.getBalance(r.address)) === 0n
      )
        throw Error("X_GAS_REQUIRED");
      const quote = await liveQuote(r.address, amount, false);
      const sourceRaw = quote.near
        ? await signNearDeposit(
            quote,
            wallet(r.idx).connect(bscRpc),
            sponsor
              ? (tx) => prepareRouteGas(bscRpc, 56, r.address, tx)
              : undefined,
          )
        : null;
      if (sponsor) await sponsor.ensure(56, r.idx, sourceRaw);
      const reserved = atomic(() => {
        if (conversions.active(r.idx)) return false;
        if (
          db
            .prepare("SELECT 1 FROM batches WHERE route=? AND stage!='paid'")
            .get(r.idx)
        )
          return false;
        const spent = db
          .prepare("SELECT input FROM batches WHERE route=?")
          .all(r.idx)
          .reduce((s, v) => s + BigInt(v.input), 0n);
        if (spent !== used) return false;
        db.prepare(
          "INSERT INTO batches(route,input,stage,request,expected) VALUES(?,?,'bridge',?,?)",
        ).run(
          r.idx,
          String(amount),
          quote.requestId,
          String(quote.outputAmount),
        );
        if (sourceRaw) {
          const hash = keccak256(sourceRaw);
          db.prepare("INSERT INTO bridgeEvidence VALUES(?,?)").run(
            quote.requestId,
            JSON.stringify({
              requestId: quote.requestId,
              near: quote.near,
              hash,
            }),
          );
          db.prepare(
            "UPDATE batches SET stage='source-deposit',raw=? WHERE request=?",
          ).run(sourceRaw, quote.requestId);
        }
        return true;
      });
      if (!reserved || sourceRaw) return;
      const signer = createWalletClient({
        chain: bsc,
        account: privateKeyToAccount(wallet(r.idx).privateKey, {
          nonceManager,
        }),
        transport: http(sourceRpcUrl),
      });
      const saveEvidence = (result) => {
        if (!result) return;
        const hashes = (result.txHashes || []).filter((h) =>
          /^0x[0-9a-f]{64}$/i.test(h),
        );
        db.prepare("INSERT OR REPLACE INTO bridgeEvidence VALUES(?,?)").run(
          quote.requestId,
          JSON.stringify({
            hashes,
            requestId: result.requestId || quote.requestId,
          }),
        );
      };
      try {
        const result = await cash.executeSourceQuote(quote, {
          signer,
          recipient: r.address,
        });
        saveEvidence(result);
      } catch (e) {
        saveEvidence(e.recovery);
        throw Error("X_BRIDGE_REVIEW");
      }
      return;
    }
    if (b.stage === "source-deposit") {
      const evidence = JSON.parse(
        db
          .prepare("SELECT evidence FROM bridgeEvidence WHERE request=?")
          .get(b.request).evidence,
      );
      const hash = keccak256(b.raw);
      if (hash !== evidence.hash) throw Error("X_BRIDGE_REVIEW");
      const receipt = await bscRpc.getTransactionReceipt(hash);
      if (receipt) {
        if (receipt.status !== 1) throw Error("X_BRIDGE_REVIEW");
        if (receipt.blockNumber > (await bscRpc.getBlock("finalized")).number)
          return;
        if (
          !eq(receipt.from, r.address) ||
          transferSum(
            receipt.logs,
            BSC_USDT,
            r.address,
            evidence.near.depositAddress,
          ) !== BigInt(b.input)
        )
          throw Error("X_BRIDGE_REVIEW");
        db.prepare(
          "UPDATE batches SET stage='bridge',raw=NULL WHERE id=? AND stage='source-deposit'",
        ).run(b.id);
        // 1Click also detects deposits onchain; notify only after the transfer is confirmed.
        await cash
          .submitNearIntentsDeposit({
            depositAddress: evidence.near.depositAddress,
            txHash: hash,
          })
          .catch(() => {});
      } else if (!(await bscRpc.getTransaction(hash))) {
        if (nearDepositDeadline(evidence.near) <= Date.now() + 45_000)
          throw Error("X_BRIDGE_REVIEW");
        await sameIdentity(r);
        if (sponsor) await sponsor.ensure(56, r.idx, b.raw);
        await bscRpc.broadcastTransaction(b.raw);
      }
      return;
    }
    if (b.stage === "bridge") {
      await confirmedDestination(b, r.address);
      return;
    }
    if (b.stage === "base") {
      const v = await sameIdentity(r),
        amount = BigInt(b.output);
      const plan = validatePlan(
        await cash.prepare({
          amount,
          receive: { platform: "xmoney", currency: "USD", payee: v.handle },
        }),
        amount,
      );
      const hash = plan.register?.hashedOnchainIds?.[0];
      if (
        !/^0x[0-9a-f]{64}$/i.test(hash ?? "") ||
        (await baseRpc.getCode(plan.txs[1].to)) === "0x"
      )
        throw Error("X_ORDER_MISMATCH");
      const txs = plan.txs.map((tx) => ({
        to: tx.to,
        data: tx.data,
        value: "0",
      }));
      db.prepare(
        "UPDATE batches SET stage='approve',plan=?,payeeHash=? WHERE id=? AND stage='base'",
      ).run(JSON.stringify(txs), hash, b.id);
      return;
    }
    if (b.stage === "approve" || b.stage === "deposit") {
      const signer = wallet(r.idx).connect(baseRpc),
        tx = JSON.parse(b.plan)[b.stage === "approve" ? 0 : 1];
      if (!b.raw) {
        await sameIdentity(r);
        const populated = sponsor
          ? await prepareRouteGas(baseRpc, 8453, r.address, tx)
          : await signer.populateTransaction(tx);
        if (populated.chainId !== 8453n) throw Error("X_CHAIN_MISMATCH");
        const raw = await signer.signTransaction(populated);
        if (sponsor) await sponsor.ensure(8453, r.idx, raw);
        // Persist the signed bytes before broadcast. Recovery always uses the same hash.
        db.prepare(
          "UPDATE batches SET raw=? WHERE id=? AND stage=? AND raw IS NULL",
        ).run(raw, b.id, b.stage);
        return;
      }
      const hash = keccak256(b.raw),
        receipt = await baseRpc.getTransactionReceipt(hash);
      if (!receipt) {
        await sameIdentity(r);
        if (!(await baseRpc.getTransaction(hash))) {
          if (sponsor) await sponsor.ensure(8453, r.idx, b.raw);
          await baseRpc.broadcastTransaction(b.raw);
        }
        return;
      }
      if (receipt.status !== 1) throw Error("X_TRANSACTION_REVIEW");
      if (receipt.blockNumber > (await baseRpc.getBlock("finalized")).number)
        return;
      if (b.stage === "approve")
        db.prepare(
          "UPDATE batches SET stage='deposit',raw=NULL WHERE id=? AND stage='approve'",
        ).run(b.id);
      else {
        const result = cash.finalizePreparedCashout({
          transactionHash: hash,
          status: "success",
          logs: receipt.logs,
        });
        db.prepare(
          "UPDATE batches SET stage='matching',deposit=?,raw=NULL WHERE id=? AND stage='deposit'",
        ).run(result.depositId, b.id);
      }
      return;
    }
    const o = await cash.order(b.deposit);
    if (o.depositId !== b.deposit || o.totalAmount !== BigInt(b.output))
      throw Error("X_ORDER_MISMATCH");
    const proof = verifiedFiat(o, b.payeeHash);
    const complete =
      o.state === "delivered" &&
      proof.released === o.totalAmount &&
      proof.cents > 0n;
    if (proof.cents >= BigInt(b.cents))
      db.prepare(
        "UPDATE batches SET cents=?,stage=? WHERE id=? AND stage='matching'",
      ).run(String(proof.cents), complete ? "paid" : "matching", b.id);
    if (o.returnedAmount > 0n) throw Error("X_TRANSACTION_REVIEW");
  }
  let busy = false;
  async function tick() {
    if (!enabled || busy) return;
    busy = true;
    try {
      if (
        (await bscRpc.getNetwork()).chainId !== 56n ||
        (await baseRpc.getNetwork()).chainId !== 8453n
      )
        throw Error("X_CHAIN_MISMATCH");
      const end = (await bscRpc.getBlock("finalized")).number;
      // Resume previously committed gas transfers, even when another route is
      // waiting on the same sponsor nonce. Each route records its own issue.
      if (sponsor)
        await Promise.allSettled([sponsor.resume(56), sponsor.resume(8453)]);
      for (const r of db.prepare("SELECT * FROM routes").all()) {
        try {
          await scan(r, end);
          const fresh = db
            .prepare("SELECT * FROM routes WHERE idx=?")
            .get(r.idx);
          const pendingBatch = db
            .prepare(
              "SELECT stage FROM batches WHERE route=? AND stage!='paid' ORDER BY id LIMIT 1",
            )
            .get(r.idx);
          if (
            conversions.active(r.idx) &&
            !["source-deposit", "bridge"].includes(pendingBatch?.stage)
          ) {
            const jobs = [
              processConversion({
                db,
                book: conversions,
                r: fresh,
                p: bscRpc,
                wallet: wallet(r.idx),
                sponsor,
              }),
            ];
            // A previous batch waiting on Base / fiat uses no BSC route nonce.
            if (pendingBatch) jobs.push(runRoute(fresh));
            const failed = (await Promise.allSettled(jobs)).find(
              (result) => result.status === "rejected",
            );
            if (failed) throw failed.reason;
          } else await runRoute(fresh);
          issue(r.idx, "");
        } catch (e) {
          issue(
            r.idx,
            [
              "X_CONVERSION_REVIEW",
              "X_POOL_MISMATCH",
              "X_CONVERSION_PRICE",
              "X_GAS_REQUIRED",
              "X_GAS_FUNDING",
              "X_GAS_SPONSOR_LOW",
              "X_GAS_PRICE_HIGH",
              "X_GAS_REVIEW",
              "X_QUOTE_UNAVAILABLE",
              "X_ACCOUNT_CHANGED",
              "X_BRIDGE_REVIEW",
              "X_ORDER_MISMATCH",
              "X_TRANSACTION_REVIEW",
            ].includes(e.message)
              ? e.message
              : "X_SERVICE_WAIT",
          );
        }
      }
    } finally {
      busy = false;
    }
  }
  function status(address) {
    const r = db
      .prepare("SELECT * FROM routes WHERE address=? OR token=?")
      .get(getAddress(address), getAddress(address));
    if (!r) return null;
    const batches = db
      .prepare("SELECT stage,cents FROM batches WHERE route=? ORDER BY id")
      .all(r.idx);
    const payee = open(r.identity);
    const disclosure = payee.disclosure || { visibility: "private", purpose: "" };
    return {
      rail: "xmoney-tax",
      disclosure: {
        ...disclosure,
        ...(disclosure.visibility === "public" ? { profile: "https://x.com/" + payee.handle } : {}),
      },
      address: r.address,
      token: r.token,
      lastBlock: r.lastBlock,
      conversion: conversions.inventory(r.idx),
      received: formatUnits(r.received, 18),
      paid: formatUnits(
        batches.reduce((a, b) => a + BigInt(b.cents), 0n),
        2,
      ),
      stage: batches.at(-1)?.stage || "collecting",
      issue: r.issue,
    };
  }
  return {
    enabled,
    canCheck: true,
    identityProvider: useFx ? "FxEmbed" : "X API",
    check,
    nominations,
    bind,
    status,
    tick,
    close: () => db.close(),
    minimum: formatUnits(minimum, 18),
    maximum: formatUnits(cap, 18),
  };
}
