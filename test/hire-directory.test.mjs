import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Wallet, ZeroAddress } from "ethers";
import { createHireBoard } from "../scripts/hire-board.mjs";
const origin = "https://darkwork.fun";
function bot() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    address:
      "ed25519:" +
      Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url").toString(
        "hex",
      ),
    sign: (c) => sign(null, Buffer.from(c.message), privateKey).toString("hex"),
  };
}
function fixture(t) {
  const owner = Wallet.createRandom(),
    guest = bot(),
    worker = bot(),
    other = bot(),
    db = new DatabaseSync(":memory:"),
    ids = new Map(),
    token = Wallet.createRandom().address,
    vault = Wallet.createRandom().address;
  let chainState = { state: "funding" };
  const identity = {
    current: async (a) => ids.get(a),
    owner: async (name) => [...ids].find(([, v]) => v === name)?.[0],
    block: async () => 7,
    previous: async () => false,
  };
  const board = createHireBoard({
    db,
    editor: owner.address,
    identity,
    rewardChain: {
      info: async () => ({
        owner: owner.address,
        token,
        vault,
        asset: ZeroAddress,
        decimals: 18,
        share: 100,
        symbol: "BNB",
        available: "2000000000000000000",
      }),
      status: async () => chainState,
    },
  });
  t.after(() => board.close());
  async function authorize(actor, action) {
    const c = board.challenge({ ...action, address: actor.address }, origin);
    let sig;
    if (c.scheme === "ed25519") sig = actor.sign(c);
    else {
      const { EIP712Domain, ...types } = c.data.types;
      sig = await actor.signTypedData(c.data.domain, types, c.data.message);
    }
    return { id: c.id, signature: sig };
  }
  async function submit(actor, action) {
    return board.commit(await authorize(actor, action), origin);
  }
  return {
    board,
    guest,
    worker,
    other,
    owner,
    ids,
    token,
    authorize,
    submit,
    open() {
      chainState = { state: "open" };
    },
  };
}
const listing = {
  kind: "service",
  version: 0,
  active: true,
  verifyId: false,
  agent: "Library bot",
  title: "Translate a guide",
  description: "Bilingual translation for communities",
  delivery: "One Markdown file",
  eta: "One day",
  category: "translation",
  language: "both",
};
const request = (s, extra = {}) => ({
  kind: "post",
  service: s.service,
  version: s.version,
  title: "Museum guide",
  body: "Translate this public resource.",
  consent: true,
  ...extra,
});
test("machine listing, filter, public inbox, signed delivery and requester acceptance with no wallet", async (t) => {
  const f = fixture(t);
  const c = await f.authorize(f.worker, listing);
  const s = await f.board.commit(c, origin);
  assert.deepEqual(await f.board.commit(c, origin), s);
  assert.equal(
    f.board.services.list(
      new URLSearchParams({
        q: "MARKDOWN",
        category: "translation",
        language: "zh",
      }),
    ).total,
    1,
  );
  assert.equal(
    f.board.services.list(new URLSearchParams({ category: "data" })).total,
    0,
  );
  const { brief } = await f.submit(f.guest, request(s));
  assert.equal(f.board.detail(brief).service.owner, f.worker.address);
  assert.equal(f.board.services.inbox(f.worker.address).items[0].id, brief);
  await assert.rejects(
    f.submit(f.other, { kind: "accept", brief }),
    /INVITED_ONLY/,
  );
  await f.submit(f.worker, { kind: "accept", brief });
  assert.equal(f.board.detail(brief).applicants, 1);
  await assert.rejects(
    f.submit(f.other, { kind: "submit", brief, line: "Someone else's result" }),
    /INVITED_ONLY/,
  );
  const line = "A".repeat(200) + "\nhttps://example.org/output.md";
  const { entry } = await f.submit(f.worker, { kind: "submit", brief, line });
  assert.equal(f.board.entry(entry).line, line);
  await assert.rejects(
    f.submit(f.other, { kind: "select", brief, entry }),
    /OWNER/,
  );
  await f.submit(f.guest, { kind: "select", brief, entry });
  assert.equal(f.board.detail(brief).selected, entry);
});
test("concurrent changes, pause, owner protection and signed order snapshots", async (t) => {
  const f = fixture(t);
  const s = await f.submit(f.worker, listing),
    saved = await f.authorize(f.guest, request(s)),
    { brief } = await f.submit(f.guest, request(s));
  await assert.rejects(
    f.submit(f.other, { ...listing, ...s, active: false }),
    /OWNER/,
  );
  const edit = await f.submit(f.worker, {
    ...listing,
    ...s,
    delivery: "New terms",
    active: false,
  });
  assert.equal(edit.version, 2);
  await assert.rejects(f.board.commit(saved, origin), /SERVICE_CHANGED/);
  assert.equal(f.board.services.list(new URLSearchParams()).total, 0);
  assert.equal(
    f.board.services.list(new URLSearchParams({ owner: f.worker.address }))
      .items[0].active,
    0,
  );
  assert.equal(f.board.detail(brief).service.delivery, "One Markdown file");
  await f.submit(f.worker, {
    kind: "submit",
    brief,
    line: "Delivered after pausing.",
  });
  await assert.rejects(
    f.submit(f.worker, { ...listing, ...s }),
    /SERVICE_CHANGED/,
  );
});
test("ed25519 cannot claim a Binance ID; signatures bind origin and signer; EVM paid service stays gated by both address and ID", async (t) => {
  const f = fixture(t);
  const bad = await f.authorize(f.worker, listing);
  await assert.rejects(
    f.board.commit({ ...bad, signature: "00".repeat(64) }, origin),
    /SIGNATURE/,
  );
  await assert.rejects(
    f.board.commit(bad, "https://other.example"),
    /SIGNATURE/,
  );
  await assert.rejects(
    f.submit(f.worker, { ...listing, verifyId: true }),
    /ID_REQUIRED/,
  );
  const normal = await f.submit(f.worker, listing);
  const reward = { token: f.token, amount: "0.01" };
  await assert.rejects(
    f.submit(f.owner, request(normal, { reward })),
    /ID_REQUIRED/,
  );
  const verified = Wallet.createRandom(),
    imposter = Wallet.createRandom();
  f.ids.set(verified.address, "writer.ai");
  f.ids.set(imposter.address, "another.ai");
  const s = await f.submit(verified, { ...listing, verifyId: true });
  assert.equal(f.board.services.read(s.service).handle, "writer.ai");
  await assert.rejects(
    f.submit(f.guest, request(s, { reward })),
    /ID_REQUIRED/,
  );
  const { brief } = await f.submit(f.owner, request(s, { reward }));
  assert.equal(f.board.services.inbox(verified.address).items.length, 0);
  f.open();
  await f.board.rewards.sync(brief);
  await assert.rejects(
    f.submit(imposter, { kind: "submit", brief, line: "Incorrect provider" }),
    /INVITED_ONLY/,
  );
  await f.submit(verified, { kind: "accept", brief });
  const { entry } = await f.submit(verified, {
    kind: "submit",
    brief,
    line: "https://example.org/report",
  });
  assert.equal(f.board.entry(entry).handle, "writer.ai");
  await assert.rejects(
    f.submit(f.owner, { kind: "select", brief, entry }),
    /REWARD_ONCHAIN/,
  );
});
test("built-in services accept and sign real work, verify native input, recover, and leave requester acceptance to the user", async (t) => {
  const f = fixture(t),
    tools = f.board.startTools(origin);
  t.after(() => tools.stop());
  await tools.ready;
  const services = f.board.services.list(new URLSearchParams()).items;
  assert.equal(services.length, 2);
  for (const [kind, body, expected] of [
    [
      "links",
      "https://example.org/?utm_source=one https://example.org/",
      "1 unique links · 不重复链接\n\nexample.org\nhttps://example.org/",
    ],
    [
      "checklist",
      "1. Launch\n- [x] launch\nReview",
      "1 / 2 completed · 已完成\n- [x] Launch\n- [ ] Review",
    ],
  ]) {
    const s = services.find((x) => x.tool === kind);
    assert.ok(s);
    if (kind === "links")
      await assert.rejects(
        f.submit(f.guest, request({ service: s.id, version: 1 })),
        /SERVICE_INPUT_LINKS/,
      );
    const { brief } = await f.submit(
      f.guest,
      request({ service: s.id, version: 1 }, { body }),
    );
    assert.equal(f.board.detail(brief).requester, f.guest.address);
    assert.equal(
      f.board.services.orders(f.guest.address, null, "outbox").items[0].id,
      brief,
    );
    assert.equal(f.board.board().length, 0);
    await tools.tick();
    const detail = f.board.detail(brief);
    assert.equal(detail.applicants, 1);
    assert.equal(detail.selected, null);
    assert.equal(detail.submissions[0].line, expected);
    await f.submit(f.guest, {
      kind: "select",
      brief,
      entry: detail.submissions[0].id,
    });
    assert.equal(f.board.detail(brief).selected, detail.submissions[0].id);
  }
  tools.stop();
  const restarted = f.board.startTools(origin);
  t.after(() => restarted.stop());
  await restarted.ready;
  assert.deepEqual(
    f.board.services.list(new URLSearchParams()).items.map((x) => x.id),
    services.map((x) => x.id),
  );
});
