import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { Wallet, Interface, id, keccak256 } from "ethers";
import { createPonsBook } from "../scripts/pons-giving.mjs";
import { USDC } from "../scripts/peer-pay.mjs";
import { migrateRouteChains } from "../scripts/launch-chains.mjs";

test("upgrade retains existing Base collectors, encrypted identities and stablecoin accounting", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      "CREATE TABLE routes(idx INTEGER PRIMARY KEY,chain INTEGER CHECK(chain IN (56,8453)),token TEXT,address TEXT,identity TEXT,ticket TEXT,lastBlock INTEGER,received TEXT,issue TEXT,UNIQUE(chain,token));INSERT INTO routes VALUES(12,8453,'token','addr','cipher','ticket',444,'25000000','');",
    );
    migrateRouteChains(db);
    migrateRouteChains(db);
    assert.deepEqual(
      { ...db.prepare("SELECT * FROM routes").get() },
      {
        idx: 12,
        chain: 8453,
        token: "token",
        address: "addr",
        identity: "cipher",
        ticket: "ticket",
        lastBlock: 444,
        received: "25000000",
        issue: "",
      },
    );
    db.exec(
      "INSERT INTO routes(idx,chain,token,address) VALUES(13,4663,'token','other')",
    );
  } finally {
    db.close();
  }
});

test("a signed Robinhood deposit needs its own finalized Base USDC transfer and is booked once, with zero fiat paid", async () => {
  const quote = JSON.parse(
    readFileSync(
      new URL("./fixtures/robinhood-bridge-quote.json", import.meta.url),
    ),
  );
  const amount = BigInt(quote.inputAmount),
    output = BigInt(quote.minOutputAmount);
  const wallet = new Wallet(id("Dark Pons isolated fixture wallet"));
  const raw = await wallet.signTransaction({
    chainId: 4663,
    to: quote.depositAddress,
    value: amount,
    nonce: 0,
    gasPrice: 10n,
    gasLimit: 100000,
  });
  const hash = keccak256(raw),
    destHash = id("fixture Base receipt");
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      "CREATE TABLE routes(idx INTEGER PRIMARY KEY,received TEXT);INSERT INTO routes VALUES(1,'0');CREATE TABLE batches(route INTEGER,input TEXT,stage TEXT,request TEXT UNIQUE,expected TEXT,output TEXT,cents TEXT DEFAULT '0');",
    );
    const r = { idx: 1, address: wallet.address },
      txLog = new Interface([
        "event Transfer(address indexed from,address indexed to,uint256 value)",
      ]);
    let finalized = 9,
      recipient = wallet.address;
    const book = createPonsBook({
      db,
      mac: (domain, s) =>
        createHmac("sha256", "fixture")
          .update(domain + s)
          .digest(),
      atomic: (fn) => {
        db.exec("BEGIN");
        try {
          const result = fn();
          db.exec("COMMIT");
          return result;
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
      },
      source: {
        getTransactionReceipt: async () => ({
          status: 1,
          from: wallet.address,
          to: quote.depositAddress,
          blockNumber: 8,
        }),
        getBlock: async () => ({ number: 10 }),
      },
      base: {
        getBlock: async () => ({ number: finalized }),
        getTransactionReceipt: async () => ({
          blockNumber: 10,
          status: 1,
          logs: [
            {
              address: USDC,
              index: 2,
              ...txLog.encodeEventLog("Transfer", [
                quote.depositAddress,
                recipient,
                output,
              ]),
            },
          ],
        }),
      },
      cash: {
        nearIntentsStatus: async () => ({
          status: "SUCCESS",
          raw: { quoteResponse: quote.raw },
          inputAmount: amount,
          outputAmount: output,
          originTransactions: [{ hash }],
          destinationTransactions: [{ hash: destHash }],
        }),
      },
    });
    book.add(1, id("salt"), wallet.address, wallet.address);
    db.prepare(
      "INSERT INTO ponsJobs(route,kind,amount,raw,hash,quote,stage) VALUES(1,'deposit',?,?,?,?,'bridge')",
    ).run(String(amount), raw, hash, JSON.stringify(quote));
    const args = {
      wallet,
      sponsor: {},
      minimum: output,
      identity: async () => {},
    };
    await book.run(r, args);
    assert.equal(db.prepare("SELECT count(*) n FROM batches").get().n, 0);
    finalized = 10;
    recipient = quote.depositAddress;
    await assert.rejects(book.run(r, args), /X_BRIDGE_REVIEW/);
    recipient = wallet.address;
    db.prepare("INSERT INTO ponsBaseTransfers VALUES(?,?,?)").run(
      destHash,
      2,
      99,
    );
    await assert.rejects(book.run(r, args), /X_BRIDGE_REVIEW/);
    assert.equal(db.prepare("SELECT received FROM routes").get().received, "0");
    db.exec("DELETE FROM ponsBaseTransfers WHERE job=99");
    await book.run(r, args);
    assert.equal(
      db.prepare("SELECT received FROM routes").get().received,
      String(output),
    );
    const batch = db.prepare("SELECT * FROM batches").get();
    assert.equal(batch.stage, "base");
    assert.equal(batch.cents, "0");
    assert.equal(batch.output, "25000000");
    assert.equal(book.active(1), undefined);
    assert.equal(book.status(1).lastBaseHash, destHash);
  } finally {
    db.close();
  }
});
