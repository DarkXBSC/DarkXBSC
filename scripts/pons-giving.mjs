// Robinhood native creator fees enter the existing Base cashout ledger only
// after a signed bridge quote and both finalized transfer receipts agree.
import { readFileSync } from "node:fs";
import {
  AbiCoder,
  Contract,
  Interface,
  Transaction,
  Wallet,
  ZeroAddress,
  formatEther,
  getAddress,
  keccak256,
  zeroPadValue,
} from "ethers";
import { nearIntentsQuoteToJson } from "@zkp2p/cash";
import { verifyQuoteSignature } from "@defuse-protocol/one-click-sdk-typescript";
import { USDC } from "./peer-pay.mjs";
import { nearDepositDeadline, nearStatus } from "./x-public-providers.mjs";
import { prepareRouteGas } from "./x-tax-gas.mjs";
import { launchChain } from "./launch-chains.mjs";
import { nativeStablePrice } from "./x-tax-conversions.mjs";

const load = (name) =>
  JSON.parse(readFileSync(new URL("../public/" + name, import.meta.url)));
const protocol = load("protocols.json").pons;
const factoryAbi = new Interface(load("contracts/PonsFactoryV2.abi.json"));
const routerAbi = new Interface(load("contracts/PonsLaunchAndBuyV2.abi.json"));
const escrow = getAddress("0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e");
const hook = getAddress("0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044");
const sourceAsset = "nep141:hood.omft.near";
const destAsset = "nep141:base-" + USDC.toLowerCase() + ".omft.near";
const ledger = new Interface([
  "event Credited(address indexed recipient,address indexed depositor,uint256 amount)",
  "event Claimed(address indexed recipient,uint256 amount)",
  "function claim(uint256 amount) returns(uint256)",
  "function balanceOf(address) view returns(uint256)",
]);
const hookEvents = new Interface([
  "event PoolFeesSwept(bytes32 indexed poolId,uint256 protocolAmount,uint256 buybackAmount,uint256 creatorAmount,uint256 tokensLocked)",
  "event PoolFeesRescued(bytes32 indexed poolId,address indexed quoteToken,uint256 protocolAmount,uint256 creatorAmount)",
]);
const curveAbi = new Interface([
  "function deployer() view returns(address)",
  "function creatorTaxBalance() view returns(uint256)",
  "function quoteFeeBalance() view returns(uint256)",
  "function protocolFeeShareBps() view returns(uint256)",
  "function sweepFees(uint256)",
]);
const poolAbi = new Interface([
  "function pendingCreatorTax(bytes32,address) view returns(uint256)",
  "function pendingFees(bytes32,address) view returns(uint256)",
  "function sweepPoolFees(bytes32,uint256,uint256)",
]);
function poolIdFor(token, launch) {
  return keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint24", "int24", "address"],
      [ZeroAddress, token, launch.poolFee, launch.tickSpacing, hook],
    ),
  );
}
const tokenEvents = new Interface([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
const equal = (x, y) => String(x).toLowerCase() === String(y).toLowerCase();
const requireMatch = (condition) => {
  if (!condition) throw Error("X_BRIDGE_REVIEW");
};

export async function ponsQuote(cash, base, address, amount, dry = true) {
  const [price, q] = await Promise.all([
    nativeStablePrice(base, launchChain(8453)),
    cash.quoteNearIntentsSource({
      sourceAsset,
      amount,
      recipient: address,
      refundTo: address,
      tradeType: "EXACT_OUTPUT",
      deadline: new Date(Date.now() + 20 * 60_000).toISOString(),
      slippageTolerance: 50,
      dry,
    }),
  ]);
  const r = q.raw.quoteRequest;
  if (
    !verifyQuoteSignature(q.raw) ||
    r.dry !== dry ||
    r.originAsset !== sourceAsset ||
    r.destinationAsset !== destAsset ||
    r.swapType !== "EXACT_OUTPUT" ||
    BigInt(r.amount) !== amount ||
    r.depositType !== "ORIGIN_CHAIN" ||
    r.refundType !== "ORIGIN_CHAIN" ||
    r.recipientType !== "DESTINATION_CHAIN" ||
    r.depositMode !== "SIMPLE" ||
    !equal(r.refundTo, address) ||
    !equal(r.recipient, address) ||
    q.depositMemo ||
    !q.correlationId ||
    q.inputAmount <= 0n ||
    q.inputAmount !== BigInt(q.raw.quote.amountIn) ||
    q.minOutputAmount !== amount ||
    q.outputAmount !== amount ||
    q.inputAmount * price * 100n > amount * 102n * 10n ** 18n ||
    (!dry &&
      (!q.depositAddress ||
        !equal(q.depositAddress, q.raw.quote.depositAddress) ||
        equal(q.depositAddress, address) ||
        equal(q.depositAddress, ZeroAddress) ||
        !(nearDepositDeadline(q) > Date.now() + 90_000)))
  )
    throw Error("X_QUOTE_UNAVAILABLE");
  return q;
}

export function createPonsBook({ db, mac, source, base, cash, atomic }) {
  db.exec(`CREATE TABLE IF NOT EXISTS ponsRoutes(route INTEGER PRIMARY KEY,salt TEXT,issuer TEXT,curve TEXT,
    credited TEXT DEFAULT '0',claimed TEXT DEFAULT '0',spent TEXT DEFAULT '0',needsOperator INTEGER NOT NULL DEFAULT 0,UNIQUE(salt,issuer,route));
    CREATE TABLE IF NOT EXISTS ponsJobs(id INTEGER PRIMARY KEY,route INTEGER,kind TEXT,amount TEXT,
    raw TEXT NOT NULL,hash TEXT UNIQUE,quote TEXT,stage TEXT,baseHash TEXT);
    CREATE TABLE IF NOT EXISTS ponsBaseTransfers(hash TEXT NOT NULL,logIndex INTEGER NOT NULL,job INTEGER NOT NULL,PRIMARY KEY(hash,logIndex));
    CREATE UNIQUE INDEX IF NOT EXISTS ponsInFlight ON ponsJobs(route) WHERE stage!='done';`);
  const row = (idx) =>
    db.prepare("SELECT * FROM ponsRoutes WHERE route=?").get(idx);
  const active = (idx) =>
    db
      .prepare("SELECT * FROM ponsJobs WHERE route=? AND stage!='done'")
      .get(idx);
  function recipient(ticket, salt, issuer) {
    if (!/^[a-f0-9]{64}$/.test(ticket) || !/^0x[0-9a-f]{64}$/i.test(salt))
      throw Error("RECIPIENT_CHANGED");
    return new Wallet(
      mac(
        "pons-creator-fees-v1",
        JSON.stringify([ticket, salt.toLowerCase(), getAddress(issuer)]),
      ).toString("hex"),
    );
  }
  async function verifyRequest({ salt, issuer, proof }, address) {
    if (
      !proof ||
      !/^0x[0-9a-f]{8,24576}$/i.test(proof.data) ||
      !/^\d{1,78}$/.test(proof.value)
    )
      throw Error("RECIPIENT_CHANGED");
    const router = equal(proof.to, protocol.launchAndBuy);
    if (!router && !equal(proof.to, protocol.factory))
      throw Error("RECIPIENT_CHANGED");
    const iface = router ? routerAbi : factoryAbi;
    const decoded = iface.parseTransaction({ data: proof.data });
    const args = decoded?.args;
    if (
      decoded?.name !== (router ? "launchAndBuy" : "launchToken") ||
      (!router && args.length !== 3) ||
      args[0].salt !== salt ||
      args[0].creatorFeeRecipient !== address ||
      args[0].creatorTaxBps === 0n ||
      args[0].buybackEnabled ||
      args[1] !== 0n ||
      args[2] !== ZeroAddress ||
      (router && (args[5] !== getAddress(issuer) || args[6].length))
    )
      throw Error("RECIPIENT_CHANGED");
    const response = await source.call({
      from: getAddress(issuer),
      to: proof.to,
      data: proof.data,
      value: BigInt(proof.value),
    });
    const { token, curve } = iface.decodeFunctionResult(
      decoded.fragment,
      response,
    );
    return { token, curve };
  }
  function add(idx, salt, issuer, curve) {
    db.prepare(
      "INSERT INTO ponsRoutes(route,salt,issuer,curve) VALUES(?,?,?,?)",
    ).run(idx, salt, getAddress(issuer), curve);
  }
  function reserved(idx) {
    const p = row(idx);
    return p ? BigInt(p.claimed) - BigInt(p.spent) : 0n;
  }
  function authorized(idx, raw) {
    const j = active(idx);
    return j?.kind === "deposit" && j.raw === raw;
  }
  function status(idx) {
    const p = row(idx),
      j = active(idx);
    return {
      credited: formatEther(p.credited),
      claimed: formatEther(p.claimed),
      available: formatEther(reserved(idx)),
      stage:
        j?.stage === "bridge"
          ? "bridge"
          : j?.kind ||
            (p.needsOperator
              ? "awaiting-operator"
              : BigInt(p.credited) > 0n
                ? "collecting"
                : "awaiting-sweep"),
      lastBaseHash: db
        .prepare(
          "SELECT baseHash FROM ponsJobs WHERE route=? AND baseHash IS NOT NULL ORDER BY id DESC LIMIT 1",
        )
        .get(idx)?.baseHash,
    };
  }
  async function scan(r, head) {
    const p = row(r.idx);
    if (head <= r.lastBlock) return;
    const advance = (end, sum) =>
      atomic(() => {
        if (
          db
            .prepare(
              "UPDATE routes SET lastBlock=? WHERE idx=? AND lastBlock=?",
            )
            .run(end, r.idx, r.lastBlock).changes
        )
          db.prepare("UPDATE ponsRoutes SET credited=? WHERE route=?").run(
            String(BigInt(p.credited) + sum),
            r.idx,
          );
      });
    if ((await source.getCode(r.token, head)) === "0x")
      return advance(head, 0n);
    const launch = await new Contract(
      protocol.factory,
      factoryAbi,
      source,
    ).getLaunchedToken(r.token, { blockTag: head });
    requireMatch(
      launch.exists &&
        launch.curve === p.curve &&
        launch.deployer === p.issuer &&
        launch.pairToken === ZeroAddress,
    );
    const end = Math.min(head, r.lastBlock + 2000);
    const poolId = poolIdFor(r.token, launch);
    const logs = await source.getLogs({
      address: escrow,
      topics: [
        ledger.getEvent("Credited").topicHash,
        zeroPadValue(r.address, 32),
        [zeroPadValue(p.curve, 32), zeroPadValue(hook, 32)],
      ],
      fromBlock: r.lastBlock + 1,
      toBlock: end,
    });
    let sum = 0n;
    const hookTxs = new Set();
    for (const log of logs) {
      const { depositor, amount } = ledger.parseLog(log).args;
      if (depositor === p.curve) sum += amount;
      else hookTxs.add(log.transactionHash);
    }
    for (const hash of hookTxs) {
      const receipt = await source.getTransactionReceipt(hash);
      requireMatch(receipt?.status === 1 && receipt.blockNumber <= end);
      // Pair the hook's credit and its following pool-specific sweep within the same receipt.
      let credits = 0n;
      for (const log of receipt.logs) {
        if (
          equal(log.address, escrow) &&
          log.topics[0] === ledger.getEvent("Credited").topicHash
        ) {
          const e = ledger.parseLog(log).args;
          if (e.depositor === hook && e.recipient === r.address)
            credits += e.amount;
        } else if (equal(log.address, hook)) {
          const e = hookEvents.parseLog(log);
          if (!e) continue;
          if (
            e.args.poolId === poolId &&
            (e.name !== "PoolFeesRescued" ||
              e.args.quoteToken === ZeroAddress) &&
            credits >= e.args.creatorAmount
          )
            sum += e.args.creatorAmount;
          credits = 0n;
        }
      }
    }
    advance(end, sum);
  }
  function save(idx, kind, amount, raw, quote = null) {
    db.prepare(
      "INSERT INTO ponsJobs(route,kind,amount,raw,hash,quote,stage) VALUES(?,?,?,?,?,?,'signed')",
    ).run(idx, kind, String(amount), raw, keccak256(raw), quote);
  }
  async function run(r, { wallet, sponsor, minimum, identity }) {
    if (!sponsor) throw Error("X_GAS_REQUIRED");
    const p = row(r.idx),
      j = active(r.idx);
    if (j) {
      const tx = Transaction.from(j.raw);
      requireMatch(
        tx.from === r.address &&
          tx.chainId === 4663n &&
          keccak256(j.raw) === j.hash,
      );
      const q = j.quote && JSON.parse(j.quote);
      if (j.kind === "sweep") {
        requireMatch(
          tx.value === 0n &&
            ((tx.to === p.curve &&
              tx.data === curveAbi.encodeFunctionData("sweepFees", [0])) ||
              (tx.to === hook &&
                tx.data ===
                  poolAbi.encodeFunctionData("sweepPoolFees", [
                    poolIdFor(
                      r.token,
                      await new Contract(
                        protocol.factory,
                        factoryAbi,
                        source,
                      ).getLaunchedToken(r.token),
                    ),
                    0,
                    0,
                  ]))),
        );
      } else if (j.kind === "claim")
        requireMatch(
          tx.to === escrow &&
            tx.value === 0n &&
            tx.data === ledger.encodeFunctionData("claim", [BigInt(j.amount)]),
        );
      else
        requireMatch(
          q &&
            tx.to === getAddress(q.depositAddress) &&
            tx.value === BigInt(j.amount) &&
            tx.data === "0x" &&
            verifyQuoteSignature(q.raw),
        );
      const receipt = await source.getTransactionReceipt(j.hash);
      if (!receipt) {
        if (await source.getTransaction(j.hash)) return;
        await identity(r);
        if (q && !(nearDepositDeadline(q) > Date.now() + 45000)) {
          // No signed bytes have left this service before 'submitted'. A quote
          // expiring during gas funding can therefore be replaced safely.
          if (j.stage === "signed") {
            db.prepare(
              "UPDATE ponsJobs SET stage='done' WHERE id=? AND stage='signed'",
            ).run(j.id);
            return;
          }
          throw Error("X_BRIDGE_REVIEW");
        }
        await sponsor.ensure(4663, r.idx, j.raw);
        db.prepare(
          "UPDATE ponsJobs SET stage='submitted' WHERE id=? AND stage='signed'",
        ).run(j.id);
        await source.broadcastTransaction(j.raw);
        return;
      }
      if (receipt.blockNumber > (await source.getBlock("finalized")).number)
        return;
      requireMatch(
        receipt.status === 1 &&
          equal(receipt.from, r.address) &&
          equal(receipt.to, tx.to),
      );
      if (j.kind === "sweep") {
        db.prepare("UPDATE ponsJobs SET stage='done' WHERE id=?").run(j.id);
        return;
      }
      if (j.kind === "claim") {
        requireMatch(
          receipt.logs.some(
            (l) =>
              equal(l.address, escrow) &&
              l.topics[0] === ledger.getEvent("Claimed").topicHash &&
              ledger.parseLog(l).args.recipient === r.address &&
              ledger.parseLog(l).args.amount === BigInt(j.amount),
          ),
        );
        atomic(() => {
          if (
            db
              .prepare(
                "UPDATE ponsJobs SET stage='done' WHERE id=? AND stage!='done'",
              )
              .run(j.id).changes
          )
            db.prepare("UPDATE ponsRoutes SET claimed=? WHERE route=?").run(
              String(BigInt(p.claimed) + BigInt(j.amount)),
              r.idx,
            );
        });
        return;
      }
      if (j.stage !== "bridge") {
        atomic(() => {
          if (
            db
              .prepare(
                "UPDATE ponsJobs SET stage='bridge' WHERE id=? AND stage!='bridge' AND stage!='done'",
              )
              .run(j.id).changes
          )
            db.prepare("UPDATE ponsRoutes SET spent=? WHERE route=?").run(
              String(BigInt(p.spent) + BigInt(j.amount)),
              r.idx,
            );
        });
        await cash
          .submitNearIntentsDeposit({
            depositAddress: q.depositAddress,
            txHash: j.hash,
          })
          .catch(() => {});
        return;
      }
      const s = await nearStatus(cash, { near: q, hash: j.hash });
      if (s.status === "failure") throw Error("X_BRIDGE_REVIEW");
      if (s.status !== "success") return;
      const end = (await base.getBlock("finalized")).number;
      let got = 0n;
      const transfers = [];
      const hashes = [...new Set(s.txHashes)];
      for (const hash of hashes) {
        const out = await base.getTransactionReceipt(hash);
        if (!out || out.blockNumber > end) return;
        requireMatch(out.status === 1);
        for (const l of out.logs)
          if (
            equal(l.address, USDC) &&
            l.topics[0] === tokenEvents.getEvent("Transfer").topicHash
          ) {
            const e = tokenEvents.parseLog(l);
            if (e.args.to === r.address && e.args.value > 0n) {
              requireMatch(Number.isSafeInteger(l.index) && l.index >= 0);
              transfers.push({ hash: hash.toLowerCase(), index: l.index });
              got += e.args.value;
            }
          }
      }
      requireMatch(
        got === s.settledAmount &&
          got >= BigInt(q.minOutputAmount) &&
          hashes.length > 0,
      );
      atomic(() => {
        if (
          !db
            .prepare(
              "UPDATE ponsJobs SET stage='done',baseHash=? WHERE id=? AND stage='bridge'",
            )
            .run(hashes[0], j.id).changes
        )
          return;
        for (const t of transfers) {
          const result = db
            .prepare(
              "INSERT OR IGNORE INTO ponsBaseTransfers(hash,logIndex,job) VALUES(?,?,?)",
            )
            .run(t.hash, t.index, j.id);
          requireMatch(result.changes === 1);
        }
        const old = db
          .prepare("SELECT received FROM routes WHERE idx=?")
          .get(r.idx);
        db.prepare("UPDATE routes SET received=? WHERE idx=?").run(
          String(BigInt(old.received) + got),
          r.idx,
        );
        db.prepare(
          "INSERT INTO batches(route,input,stage,request,expected,output) VALUES(?,?,'base',?,?,?)",
        ).run(
          r.idx,
          String(got),
          "near:" + q.correlationId,
          String(q.minOutputAmount),
          String(got),
        );
      });
      return;
    }
    const available = reserved(r.idx),
      unclaimed = BigInt(p.credited) - BigInt(p.claimed);
    if ((await source.getCode(r.token, "finalized")) === "0x") return;
    const price = await nativeStablePrice(base, launchChain(8453));
    const floor = minimum * 10n ** 18n;
    const at = { blockTag: "finalized" };
    if ((available + unclaimed) * price < (floor * 102n) / 100n) {
      const launch = await new Contract(
        protocol.factory,
        factoryAbi,
        source,
      ).getLaunchedToken(r.token, at);
      if (
        launch.curve !== p.curve ||
        launch.creatorFeeRecipient !== r.address ||
        launch.buybackEnabled
      )
        throw Error("X_POOL_MISMATCH");
      let pending = 0n,
        target,
        data;
      if (launch.phase === 0n) {
        const c = new Contract(p.curve, curveAbi, source);
        const [owner, tax, fees, share] = await Promise.all([
          c.deployer(at),
          c.creatorTaxBalance(at),
          c.quoteFeeBalance(at),
          c.protocolFeeShareBps(at),
        ]);
        if (owner === r.address) {
          pending = tax + fees - (fees * share) / 10000n;
          target = p.curve;
          data = curveAbi.encodeFunctionData("sweepFees", [0]);
        }
      } else if (launch.phase === 2n) {
        const poolId = poolIdFor(r.token, launch),
          c = new Contract(hook, poolAbi, source);
        const [tax, fees, tokenFees, tokenTax, policy] = await Promise.all([
          c.pendingCreatorTax(poolId, ZeroAddress, at),
          c.pendingFees(poolId, ZeroAddress, at),
          c.pendingFees(poolId, r.token, at),
          c.pendingCreatorTax(poolId, r.token, at),
          new Contract(protocol.factory, factoryAbi, source).getLaunchFeePolicy(
            r.token,
            at,
          ),
        ]);
        const needsOperator = Number(tokenFees + tokenTax > 0n);
        if (p.needsOperator !== needsOperator) {
          db.prepare("UPDATE ponsRoutes SET needsOperator=? WHERE route=?").run(
            needsOperator,
            r.idx,
          );
        }
        if (!needsOperator) {
          pending = tax + fees - (fees * policy.protocolFeeShareBps) / 10000n;
          target = hook;
          data = poolAbi.encodeFunctionData("sweepPoolFees", [poolId, 0, 0]);
        }
      }
      if (
        pending > 0n &&
        (pending + available + unclaimed) * price >= (floor * 98n) / 100n
      ) {
        const check = await ponsQuote(cash, base, r.address, minimum);
        if (
          available + unclaimed < check.inputAmount &&
          pending + available + unclaimed >= check.inputAmount
        ) {
          await identity(r);
          const prepared = await prepareRouteGas(source, 4663, r.address, {
            to: target,
            data,
            value: 0n,
          });
          save(r.idx, "sweep", 0n, await wallet.signTransaction(prepared));
          return;
        }
      }
    }
    if ((available + unclaimed) * price < (floor * 98n) / 100n) return;
    await identity(r);
    const quote = await ponsQuote(
      cash,
      base,
      r.address,
      minimum,
      available * price < (minimum * 10n ** 18n * 98n) / 100n,
    );
    if (available + unclaimed < quote.inputAmount) return;
    let kind,
      amount,
      request,
      evidence = null;
    if (available < quote.inputAmount) {
      kind = "claim";
      amount = unclaimed;
      const owed = await new Contract(escrow, ledger, source).balanceOf(
        r.address,
        { blockTag: "finalized" },
      );
      requireMatch(amount > 0n && owed >= amount);
      request = {
        to: escrow,
        data: ledger.encodeFunctionData("claim", [amount]),
        value: 0n,
      };
    } else {
      if (quote.request.dry) return;
      kind = "deposit";
      amount = quote.inputAmount;
      request = {
        to: getAddress(quote.depositAddress),
        value: amount,
        data: "0x",
      };
      evidence = JSON.stringify(nearIntentsQuoteToJson(quote));
    }
    const raw = await wallet.signTransaction(
      await prepareRouteGas(source, 4663, r.address, request),
    );
    save(r.idx, kind, amount, raw, evidence);
  }
  return {
    row,
    active,
    add,
    status,
    scan,
    run,
    reserved,
    authorized,
    recipient,
    verifyRequest,
  };
}
