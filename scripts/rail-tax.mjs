// BSC-only Flap tax -> USDT -> RAILGUN. One route wallet and one nonce journal per launch.
import {
  Contract,
  Interface,
  Transaction,
  ZeroAddress,
  formatEther,
  getAddress,
  keccak256,
  parseEther,
} from "ethers";
import { readFileSync } from "node:fs";
import { launchChain, predictTaxToken, taxClone } from "./launch-chains.mjs";
import { prepareRouteGas } from "./x-tax-gas.mjs";
import {
  createShieldCall,
  validateRailgunAddress,
} from "../src/lib/railgun-crypto.mjs";
import { railgunNetwork, railgunAbi } from "../src/lib/railgun-config.mjs";

const cfg = launchChain(56),
  pool = railgunNetwork("bsc").proxy,
  size = parseEther("25");
const rail = new Interface(railgunAbi),
  portal = new Interface(
    JSON.parse(
      readFileSync(
        new URL("../public/contracts/IPortal.abi.json", import.meta.url),
      ),
    ),
  );
const erc = new Interface([
  "function balanceOf(address) view returns(uint256)",
  "function allowance(address,address) view returns(uint256)",
  "function approve(address,uint256) returns(bool)",
]);
const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

export function railTaxBook({
  db,
  atomic,
  mac,
  seal,
  open,
  p,
  wallet,
  conversions,
}) {
  db.exec(`CREATE TABLE IF NOT EXISTS railRoutes(route INTEGER PRIMARY KEY,quote TEXT NOT NULL,share INTEGER NOT NULL,creation TEXT,issuer TEXT);
  CREATE TABLE IF NOT EXISTS railBatches(id INTEGER PRIMARY KEY,route INTEGER NOT NULL,seq INTEGER NOT NULL,stage TEXT NOT NULL,raw TEXT,hash TEXT,npk TEXT,fee TEXT,net TEXT,block INTEGER,UNIQUE(route,seq));
  CREATE UNIQUE INDEX IF NOT EXISTS railOpen ON railBatches(route) WHERE stage!='confirmed';`);
  const row = (id) =>
    db.prepare("SELECT * FROM railRoutes WHERE route=?").get(id);
  const job = (id) =>
    db
      .prepare("SELECT * FROM railBatches WHERE route=? AND stage!='confirmed'")
      .get(id);
  function check({ recipient, quote, share, key, chainId }) {
    if (chainId !== 56 || ![ZeroAddress, cfg.stable].some((a) => eq(a, quote)))
      throw Error("RAIL_POOL_UNSUPPORTED");
    if (
      !Number.isInteger(share) ||
      share < 1 ||
      share > 10000 ||
      !/^[a-f0-9]{64}$/.test(key)
    )
      throw Error("INVALID_SHARE");
    validateRailgunAddress(recipient, "bsc");
    const ticket = mac(
      "rail-tax-v1",
      JSON.stringify([56, recipient, getAddress(quote), share, key]),
    ).toString("hex");
    return { state: "READY", ticket };
  }
  async function bind(input) {
    const { ticket } = check(input);
    if (ticket !== input.ticket || !/^0x[\da-f]{64}$/i.test(input.salt))
      throw Error("RECIPIENT_CHANGED");
    const token = predictTaxToken(input.salt, 56),
      quote = getAddress(input.quote);
    if (!token.toLowerCase().endsWith("7777")) throw Error("INVALID_FLAP_SALT");
    const existing = db
      .prepare("SELECT idx FROM routes WHERE chain=56 AND token=?")
      .get(token);
    const block = (await p.getBlock("finalized")).number;
    if (!existing && (await p.getCode(token, block)) !== "0x")
      throw Error("SALT_ALREADY_USED");
    return atomic(() => {
      let r = db
        .prepare("SELECT * FROM routes WHERE chain=56 AND token=?")
        .get(token);
      if (r && (r.ticket !== ticket || !row(r.idx)))
        throw Error("RECIPIENT_CHANGED");
      if (!r) {
        const idx = db
          .prepare("SELECT COALESCE(MAX(idx),-1)+1 n FROM routes")
          .get().n;
        const address = wallet(idx).address;
        db.prepare(
          "INSERT INTO routes(idx,chain,token,address,identity,ticket,lastBlock) VALUES(?,56,?,?,?,?,?)",
        ).run(
          idx,
          token,
          address,
          seal({ recipient: input.recipient }),
          ticket,
          block,
        );
        db.prepare(
          "INSERT INTO railRoutes(route,quote,share) VALUES(?,?,?)",
        ).run(idx, quote, input.share);
        if (quote === ZeroAddress)
          conversions.register(
            idx,
            { address: quote, decimals: 18, symbol: "BNB" },
            block,
          );
        r = { address };
      }
      return {
        chainId: 56,
        rail: "railgun-tax",
        token,
        ticket,
        address: r.address,
        asset: quote,
      };
    });
  }
  // All reservations share one finalized Portal log scan, including abandoned launches.
  // A matched route resumes tax scanning at its creation block, including the first buy.
  async function discoverPending() {
    const { cursor } = db
      .prepare(
        "SELECT MIN(r.lastBlock) cursor FROM routes r JOIN railRoutes s ON s.route=r.idx WHERE s.creation IS NULL AND r.issue!='RAIL_LAUNCH_MISMATCH'",
      )
      .get();
    if (cursor == null) return;
    const head = (await p.getBlock("finalized")).number,
      end = Math.min(head, cursor + 1500);
    if (end <= cursor) return;
    const logs = await p.getLogs({
      address: cfg.portal,
      topics: [portal.getEvent("TokenCreated").topicHash],
      fromBlock: cursor + 1,
      toBlock: end,
    });
    for (const log of logs) {
      const token = getAddress(portal.parseLog(log).args.token);
      const r = db
        .prepare(
          "SELECT r.idx,r.address,s.share,s.quote FROM routes r JOIN railRoutes s ON s.route=r.idx WHERE r.chain=56 AND r.token=? AND r.lastBlock<? AND s.creation IS NULL AND r.issue!='RAIL_LAUNCH_MISMATCH'",
        )
        .get(token, log.blockNumber);
      if (!r) continue;
      const [tx, code] = await Promise.all([
        p.getTransaction(log.transactionHash),
        p.getCode(token, log.blockNumber),
      ]);
      if (!tx) throw Error("RAIL_PROVIDER_WAIT");
      const params =
        eq(tx.to, cfg.portal) &&
        tx.data.startsWith(portal.getFunction("newTokenV6").selector)
          ? portal.decodeFunctionData("newTokenV6", tx.data)[0]
          : null;
      if (
        !params ||
        code.toLowerCase() !== taxClone(56) ||
        !eq(params.beneficiary, r.address) ||
        !eq(params.quoteToken, r.quote) ||
        !eq(predictTaxToken(params.salt, 56), token) ||
        params.mktBps !== BigInt(r.share) ||
        params.lpBps !== BigInt(10000 - r.share) ||
        params.tokenVersion !== 6n
      ) {
        db.prepare(
          "UPDATE routes SET issue='RAIL_LAUNCH_MISMATCH' WHERE idx=?",
        ).run(r.idx);
        continue;
      }
      atomic(() => {
        db.prepare(
          "UPDATE railRoutes SET creation=?,issuer=? WHERE route=? AND creation IS NULL",
        ).run(tx.hash, getAddress(tx.from), r.idx);
        db.prepare("UPDATE routes SET lastBlock=? WHERE idx=?").run(
          log.blockNumber - 1,
          r.idx,
        );
      });
    }
    db.prepare(
      "UPDATE routes SET lastBlock=? WHERE lastBlock<? AND issue!='RAIL_LAUNCH_MISMATCH' AND idx IN (SELECT route FROM railRoutes WHERE creation IS NULL)",
    ).run(end, end);
  }
  const count = (id) =>
    db.prepare("SELECT COUNT(*) n FROM railBatches WHERE route=?").get(id).n;
  const available = (r) => BigInt(r.received) - size * BigInt(count(r.idx));
  async function settle(r, sponsor) {
    if (!sponsor) throw Error("X_GAS_REQUIRED");
    let b = job(r.idx);
    if (!b) {
      if (available(r) < size) return;
      atomic(() => {
        if (job(r.idx) || conversions.active(r.idx) || available(r) < size)
          return;
        db.prepare(
          "INSERT INTO railBatches(route,seq,stage) VALUES(?,?,'queued')",
        ).run(r.idx, count(r.idx) + 1);
      });
      b = job(r.idx);
      if (!b) return;
    }
    if (b.stage === "review") throw Error("RAIL_RECEIPT_REVIEW");
    if (b.stage === "queued") {
      const usdt = new Contract(cfg.stable, erc, p);
      if ((await usdt.balanceOf(r.address, { blockTag: "finalized" })) < size)
        throw Error("RAIL_BALANCE_REVIEW");
      const allowance = await usdt.allowance(r.address, pool);
      let tx,
        stage,
        npk = null;
      if (allowance < size) {
        stage = "approving";
        tx = {
          to: cfg.stable,
          data: erc.encodeFunctionData("approve", [
            pool,
            allowance === 0n ? size : 0n,
          ]),
        };
      } else {
        const call = await createShieldCall({
          chain: "bsc",
          address: open(r.identity).recipient,
          token: cfg.stable,
          amount: String(size),
        });
        stage = "shielding";
        npk = call.npk;
        tx = { to: call.to, data: call.data };
      }
      const raw = await wallet(r.idx).signTransaction(
        await prepareRouteGas(p, 56, r.address, tx),
      );
      db.prepare(
        "UPDATE railBatches SET raw=?,hash=?,npk=?,stage=? WHERE id=? AND stage='queued'",
      ).run(raw, keccak256(raw), npk, stage, b.id);
      return;
    }
    const tx = Transaction.from(b.raw);
    if (
      !eq(tx.from, r.address) ||
      tx.chainId !== 56n ||
      tx.hash !== b.hash ||
      tx.value !== 0n ||
      !eq(tx.to, b.stage === "approving" ? cfg.stable : pool)
    )
      throw Error("RAIL_RECEIPT_REVIEW");
    const receipt = await p.getTransactionReceipt(b.hash);
    if (!receipt) {
      if (await p.getTransaction(b.hash)) return;
      if ((await p.getTransactionCount(r.address, "finalized")) > tx.nonce)
        throw Error("RAIL_RECEIPT_REVIEW");
      await sponsor.ensure(56, r.idx, b.raw);
      await p.broadcastTransaction(b.raw);
      return;
    }
    if (receipt.blockNumber > (await p.getBlock("finalized")).number) return;
    if (
      receipt.status === 1 &&
      eq(receipt.to, tx.to) &&
      eq(receipt.from, r.address)
    ) {
      if (b.stage === "approving") {
        db.prepare(
          "UPDATE railBatches SET raw=NULL,hash=NULL,stage='queued' WHERE id=? AND hash=?",
        ).run(b.id, b.hash);
        return;
      }
      for (const l of receipt.logs) {
        if (
          !eq(l.address, pool) ||
          l.topics[0] !== rail.getEvent("Shield").topicHash
        )
          continue;
        const ev = rail.parseLog(l).args,
          n = ev.commitments[0];
        if (
          ev.commitments.length === 1 &&
          eq(n.npk, b.npk) &&
          eq(n.token.tokenAddress, cfg.stable) &&
          n.value + ev.fees[0] === size &&
          n.value > 0n
        ) {
          db.prepare(
            "UPDATE railBatches SET raw=NULL,stage='confirmed',fee=?,net=?,block=? WHERE id=? AND hash=?",
          ).run(
            String(ev.fees[0]),
            String(n.value),
            receipt.blockNumber,
            b.id,
            b.hash,
          );
          return;
        }
      }
    }
    db.prepare(
      "UPDATE railBatches SET stage='review' WHERE id=? AND hash=?",
    ).run(b.id, b.hash);
    throw Error("RAIL_RECEIPT_REVIEW");
  }
  function status(address) {
    const r = db
      .prepare(
        "SELECT r.*,s.share,s.creation,s.issuer FROM routes r JOIN railRoutes s ON s.route=r.idx WHERE r.chain=56 AND (r.token=? OR r.address=?)",
      )
      .get(getAddress(address), getAddress(address));
    if (!r) return null;
    const batches = db
      .prepare(
        "SELECT seq,stage,hash,fee,net,block FROM railBatches WHERE route=? ORDER BY seq DESC",
      )
      .all(r.idx);
    const pending = batches.find((b) => b.stage !== "confirmed");
    const remaining = available(r);
    return {
      rail: "railgun-tax",
      chainId: 56,
      token: r.token,
      collector: r.address,
      share: r.share,
      creation: r.creation,
      issuer: r.issuer,
      lastBlock: r.lastBlock,
      received: formatEther(r.received),
      available: formatEther(remaining),
      threshold: "25",
      shortfall: formatEther(remaining >= size ? 0n : size - remaining),
      shielded: formatEther(
        batches.reduce((s, b) => s + BigInt(b.net || 0), 0n),
      ),
      conversion: conversions.inventory(r.idx),
      issue: r.issue,
      stage: !r.creation ? "awaiting-launch" : pending?.stage || "collecting",
      batches: batches.map((b) => ({
        seq: b.seq,
        stage: b.stage,
        hash: b.hash,
        block: b.block,
        gross: "25",
        net: b.net && formatEther(b.net),
        fee: b.fee && formatEther(b.fee),
      })),
    };
  }
  return { check, bind, discoverPending, settle, row, job, available, status };
}
