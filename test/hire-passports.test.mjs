import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { Wallet, id, verifyTypedData } from "ethers";
import { createHireBoard } from "../scripts/hire-board.mjs";
import { PAY_NETWORK } from "../src/lib/agent-pay.ts";
import { passports } from "../scripts/hire-passports.mjs";
const origin = "https://darkwork.fun";
function fixture(t) {
  const db = new DatabaseSync(":memory:");
  const [author, buyer, peer, newcomer] = Array.from({ length: 4 }, () =>
    Wallet.createRandom(),
  );
  const names = new Map([
    [author.address, "maker.ai"],
    [buyer.address, "buyer.ai"],
    [peer.address, "reader.ai"],
  ]);
  const stamp = (addr) =>
    names.has(addr)
      ? {
          name: names.get(addr),
          wallet: addr,
          block: 123,
          registry: PAY_NETWORK.agentId,
        }
      : null;
  const board = createHireBoard({
    db,
    editor: buyer.address,
    identity: {
      current: async (a) => names.get(a),
      attest: async (a) => stamp(a),
    },
  });
  t.after(() => board.close());
  async function packet(w, action) {
    const c = await board.challenge({ ...action, address: w.address }, origin);
    const { EIP712Domain, ...types } = c.data.types;
    return {
      id: c.id,
      signature: await w.signTypedData(c.data.domain, types, c.data.message),
    };
  }
  async function run(w, action) {
    return board.commit(await packet(w, action), origin);
  }
  async function makeWork(self = false) {
    const { brief } = await run(self ? author : buyer, {
      kind: "post",
      title: "Community guide",
      body: "Check the public library hours",
      consent: true,
    });
    const { entry } = await run(author, {
      kind: "submit",
      brief,
      line: "Saturday hours updated.",
      visitor: randomUUID(),
    });
    return { brief, entry };
  }
  return {
    board,
    db,
    author,
    buyer,
    peer,
    newcomer,
    names,
    stamp,
    packet,
    run,
    makeWork,
  };
}
const params = new URLSearchParams(),
  review = (entry) => ({
    kind: "review",
    entry,
    verdict: "needs_evidence",
    note: "The Sunday opening time lacks a cited source.",
  });
test("only the author can opt in a selected work, and only a distinct current Agent ID can review it", async (t) => {
  const f = fixture(t),
    { brief, entry } = await f.makeWork(),
    show = { kind: "showcase", entry };
  await assert.rejects(f.run(f.author, show), /PASSPORT_INELIGIBLE/);
  await f.run(f.buyer, { kind: "select", brief, entry });
  assert.equal(f.board.detail(brief).portfolioEntry, entry);
  assert.equal(f.board.portfolio.list(params).items.length, 0);
  await assert.rejects(f.run(f.peer, review(entry)), /PASSPORT_UNLISTED/);
  await assert.rejects(f.run(f.buyer, show), /HIRE_OWNER/);
  const signed = await f.packet(f.author, show);
  await assert.rejects(
    f.board.commit(signed, "https://wrong.example"),
    /HIRE_SIGNATURE/,
  );
  const receipt = await f.board.commit(signed, origin);
  assert.deepEqual(await f.board.commit(signed, origin), receipt);
  await assert.rejects(f.run(f.author, show), /PASSPORT_DUPLICATE/);
  await assert.rejects(f.run(f.author, review(entry)), /PASSPORT_PARTY/);
  await assert.rejects(f.run(f.buyer, review(entry)), /PASSPORT_PARTY/);
  await assert.rejects(f.run(f.newcomer, review(entry)), /HIRE_ID_REQUIRED/);
  assert.throws(
    () =>
      f.board.challenge(
        { ...review(entry), address: "ed25519:" + "12".repeat(32) },
        origin,
      ),
    /HIRE_ID_REQUIRED/,
  );
  const stale = await f.packet(f.peer, review(entry));
  f.names.delete(f.peer.address);
  await assert.rejects(f.board.commit(stale, origin), /HIRE_ID_REQUIRED/);
  f.names.set(f.peer.address, "reader.ai");
  await assert.rejects(
    f.run(f.peer, { ...review(entry), note: "" }),
    /HIRE_INPUT/,
  );
  const attempts = await Promise.all([
    f.packet(f.peer, review(entry)),
    f.packet(f.peer, review(entry)),
  ]);
  const results = await Promise.allSettled(
    attempts.map((p) => f.board.commit(p, origin)),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.match(
    results.find((r) => r.status === "rejected").reason.message,
    /PASSPORT_DUPLICATE/,
  );
  const store = passports(f.db, Date.now),
    card = store.card(entry),
    op = card.reviews[0];
  assert.equal(op.verdict, "needs_evidence");
  assert.equal(card.reviewCount, 1);
  for (const [proofId, signer, kind] of [
    [receipt.proof, f.author, "showcase"],
    [op.proof, f.peer, "review"],
  ]) {
    const p = store.proof(proofId);
    assert.equal(
      verifyTypedData(p.domain, p.types, p.message, p.signature),
      signer.address,
    );
    assert.equal(p.block, 123);
    assert.equal(p.message.verifiedBlock, p.block);
    assert.equal(p.message.agentId, p.name);
    assert.equal(p.message.registry, p.registry);
    assert.equal(p.chainId, 56);
    assert.equal(p.message.action, kind);
    assert.equal(
      JSON.parse(p.message.content.split("\n")[1]).workHash,
      id("Saturday hours updated."),
    );
  }
  assert.equal(
    store.list(new URLSearchParams({ pending: "1" })).items.length,
    0,
  );
  assert.deepEqual(
    { ...store.profile(f.stamp(f.author.address), params).totals },
    { works: 1, reviewed: 1, paid: 0, contributions: 0 },
  );
  assert.equal(
    store.profile(
      f.stamp(f.peer.address),
      new URLSearchParams({ role: "reviewer" }),
    ).items[0].entry,
    entry,
  );
  assert.equal(
    store.profile({ name: "maker.ai", wallet: f.newcomer.address }, params)
      .items.length,
    0,
  );
});
test("self-commission, practice, and unselected entries do not enter the review desk", async (t) => {
  const f = fixture(t),
    own = await f.makeWork(true);
  await f.run(f.author, { kind: "select", ...own });
  assert.equal(f.board.detail(own.brief).portfolioEntry, null);
  assert.throws(
    () => f.board.portfolio.record(own.entry, params),
    /INELIGIBLE/,
  );
  const { entry } = await f.run(f.author, {
    kind: "submit",
    brief: "studio",
    line: "Practice",
    visitor: randomUUID(),
  });
  await f.run(f.buyer, { kind: "select", brief: "studio", entry });
  assert.equal(f.board.detail("studio").portfolioEntry, null);
  assert.throws(() => f.board.portfolio.record(entry, params), /INELIGIBLE/);
  assert.throws(
    () => f.board.portfolio.list(new URLSearchParams({ before: "bad" })),
    /HIRE_INPUT/,
  );
});
