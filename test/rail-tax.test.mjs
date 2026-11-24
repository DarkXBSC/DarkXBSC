import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { ZeroAddress, Wallet, parseEther } from "ethers";
import { RailgunEngine, getPublicViewingKey } from "@railgun-community/engine";
import { createXTaxGiving } from "../scripts/x-tax-giving.mjs";
import { launchChain } from "../scripts/launch-chains.mjs";

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
