import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  ZeroAddress,
  Wallet,
  parseEther,
  Interface,
  getAddress,
  toBeHex,
} from "ethers";
import { RailgunEngine, getPublicViewingKey } from "@railgun-community/engine";
import { createXTaxGiving } from "../scripts/x-tax-giving.mjs";
import { launchChain, taxClone } from "../scripts/launch-chains.mjs";

const salt =
  "0x27f61932182429fa344d4b8d23facfefb7d00e09b764bcf9d3df60bb93d2ca3b";
const recipient = RailgunEngine.encodeAddress({
  masterPublicKey: 3802n,
  viewingPublicKey: await getPublicViewingKey(randomBytes(32)),
});
const pool = launchChain(56).stable;

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "dark-rail-test-"));
  const env = {
    X_TAX_SEED: randomBytes(32).toString("hex"),
    X_TAX_IDENTITY_API: "https://api.fxtwitter.com",
    X_TAX_BRIDGE_API: "https://1click.chaindefuser.com",
    X_TAX_ENABLE: "yes",
    X_TAX_MAX_USDT: "25",
  };
  const provider = {
    getBlock: async () => ({ number: 50 }),
    getCode: async () => "0x",
  };
  const service = createXTaxGiving(env, {
    dir,
    bsc: provider,
    base: {},
    cash: {},
  });
  const db = new DatabaseSync(join(dir, "routes.sqlite"));
  t.after(() => {
    service.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    book: service.railTax,
    service,
    db,
    provider,
    input: {
      chainId: 56,
      quote: pool,
      share: 8000,
      key: "5".repeat(64),
      recipient,
    },
  };
}

test("encrypted, idempotent, BSC-only reservations bind the exact split and recipient", async (t) => {
  const { book, db, service, input } = fixture(t);
  assert.throws(() => book.check({ ...input, chainId: 8453 }));
  assert.throws(() =>
    book.check({ ...input, quote: Wallet.createRandom().address }),
  );
  assert.throws(() => book.check({ ...input, recipient: ZeroAddress }));
  for (const share of [0, 10001, 0.5])
    assert.throws(() => book.check({ ...input, share }));
  const { ticket } = book.check(input);
  for (const field of [
    { quote: ZeroAddress },
    { share: 5000 },
    { key: "b".repeat(64) },
  ]) {
    await assert.rejects(
      book.bind({ ...input, ...field, salt, ticket }),
      /RECIPIENT_CHANGED/,
    );
  }
  await assert.rejects(
    book.bind({ ...input, salt: "0x" + "00".repeat(32), ticket }),
    /INVALID_FLAP_SALT/,
  );
  const r = await book.bind({ ...input, salt, ticket });
  assert.deepEqual(await book.bind({ ...input, salt, ticket }), r);
  const alternate = { ...input, share: 7000 };
  await assert.rejects(
    book.bind({ ...alternate, ...book.check(alternate), salt }),
    /RECIPIENT_CHANGED/,
  );
  assert.equal(db.prepare("SELECT count(*) n FROM routes").get().n, 1);
  assert(
    !db
      .prepare("SELECT identity FROM routes")
      .get()
      .identity.includes(recipient),
  );
  assert(!JSON.stringify(book.status(r.token)).includes(recipient));
  assert.equal(service.status(r.token), null);
});

test("ledger deducts reserved gross once and recognizes only confirmed net receipts", async (t) => {
  const { book, db, input, provider } = fixture(t);
  const r = await book.bind({ ...input, ...book.check(input), salt });
  provider.getBlock = async () => ({ number: 85 });
  let scans = 0;
  provider.getLogs = async () => {
    scans++;
    return [];
  };
  await book.discoverPending();
  await book.discoverPending();
  assert.equal(scans, 1);
  assert.equal(book.status(r.address).lastBlock, 85);
  db.prepare("UPDATE routes SET received=?").run(String(parseEther("51")));
  db.exec("INSERT INTO railBatches(route,seq,stage) VALUES(0,1,'shielding')");
  assert.throws(() =>
    db.exec("INSERT INTO railBatches(route,seq,stage) VALUES(0,2,'queued')"),
  );
  assert.equal(book.status(r.token).available, "26.0");
  assert.equal(book.status(r.token).shielded, "0.0");
  db.prepare("UPDATE railBatches SET stage='confirmed',net=?,fee=?").run(
    String(parseEther("24.9375")),
    String(parseEther("0.0625")),
  );
  db.exec("INSERT INTO railBatches(route,seq,stage) VALUES(0,2,'review')");
  const state = book.status(r.address);
  assert.equal(state.available, "1.0");
  assert.equal(state.shortfall, "24.0");
  assert.equal(state.shielded, "24.9375");
  assert.equal(state.batches[1].fee, "0.0625");
});

test("giving market admits finalized matching Flap launches before their first payment and reads their original artwork", async (t) => {
  const { book, input, provider, db } = fixture(t);
  const bound = await book.bind({ ...input, ...book.check(input), salt });
  const cid = "bafkreif52fy2kvlpmqyaxkhcra6fvksxu23oytxlvw4q4e3vvt4ibcl4fy";
  const api = new Interface(
    JSON.parse(
      readFileSync(
        new URL("../public/contracts/IPortal.abi.json", import.meta.url),
      ),
    ),
  );
  const tuple = api.getFunction("newTokenV6").inputs[0];
  const defaults = api.getAbiCoder().getDefaultValue([tuple])[0];
  const params = {
    name: "First Cat",
    symbol: "CAT",
    meta: cid,
    salt,
    beneficiary: bound.address,
    quoteToken: input.quote,
    mktBps: input.share,
    lpBps: 10000 - input.share,
    tokenVersion: 6,
  };
  const args = tuple.components.map((p, i) => params[p.name] ?? defaults[i]);
  const creation = "0x" + "12".repeat(32),
    issuer = Wallet.createRandom().address;
  provider.getTransaction = async () => ({
    to: launchChain(56).portal,
    from: issuer,
    hash: creation,
    data: api.encodeFunctionData("newTokenV6", [args]),
  });
  provider.getBlock = async () => ({ number: 55 });
  provider.getCode = async () => taxClone(56);
  provider.getLogs = async () => [
    {
      ...api.encodeEventLog("TokenCreated", [
        50,
        issuer,
        0,
        bound.token,
        params.name,
        params.symbol,
        cid,
      ]),
      blockNumber: 53,
      transactionHash: creation,
    },
  ];
  let reads = 0;
  const metadata = async (url) => {
    reads++;
    assert.equal(url, "https://flap.mypinata.cloud/ipfs/" + cid);
    return { image: "ipfs://" + cid };
  };
  assert.deepEqual((await book.launches(null, metadata)).rows, []);
  await book.discoverPending();
  const first = await book.launches(null, metadata);
  assert.deepEqual(first, {
    chainId: 56,
    nextCursor: null,
    rows: [
      {
        token: bound.token,
        name: "First Cat",
        symbol: "CAT",
        share: 8000,
        shortfall: "25.0",
        firstNet: null,
        image: "https://flap.mypinata.cloud/ipfs/" + cid,
      },
    ],
  });
  db.prepare("UPDATE routes SET received=?").run(String(parseEther("31")));
  db.exec("INSERT INTO railBatches(route,seq,stage) VALUES(0,1,'shielding')");
  assert.equal((await book.launches(null, metadata)).rows[0].shortfall, "19.0");
  assert.equal((await book.launches(null, metadata)).rows[0].firstNet, null);
  db.prepare(
    "UPDATE railBatches SET stage='confirmed',block=90,hash=?,net=?",
  ).run("0x" + "34".repeat(32), String(parseEther("24.9375")));
  assert.equal(
    (await book.launches(null, metadata)).rows[0].firstNet,
    "24.9375",
  );
  assert.equal(reads, 1);
  db.exec("UPDATE routes SET issue='RAIL_LAUNCH_MISMATCH'");
  assert.equal((await book.launches(null, metadata)).rows.length, 0);
});

test("giving market pagination stays stable across new registrations and unavailable metadata", async (t) => {
  const { book, db } = fixture(t);
  function insert(i, chain = 56) {
    const token = getAddress(toBeHex(i + 1, 20));
    db.prepare(
      "INSERT INTO routes(idx,chain,token,address,lastBlock) VALUES(?,?,?,?,?)",
    ).run(i, chain, token, getAddress(toBeHex(i + 101, 20)), 50);
    db.prepare(
      "INSERT INTO railRoutes(route,quote,share,creation) VALUES(?,?,?,?)",
    ).run(i, pool, 5000, toBeHex(i + 1, 32));
    return token;
  }
  for (let i = 0; i < 14; i++) insert(i);
  insert(21, 8453);
  const a = await book.launches(null);
  assert.equal(a.rows.length, 12);
  assert.equal(a.rows[0].token, getAddress(toBeHex(14, 20)));
  assert.equal(a.nextCursor, a.rows.at(-1).token);
  insert(22);
  const b = await book.launches(a.nextCursor);
  assert.equal(b.rows.length, 2);
  assert.equal(b.nextCursor, null);
  assert.equal(new Set([...a.rows, ...b.rows].map((r) => r.token)).size, 14);
  await assert.rejects(book.launches("invalid"), /INVALID_CURSOR/);
  await assert.rejects(book.launches(ZeroAddress), /INVALID_CURSOR/);
});
