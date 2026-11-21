import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, createHmac } from "node:crypto";
import { Wallet, Interface, ZeroAddress, parseEther } from "ethers";
import { squareStatement } from "../src/lib/square-route.ts";
import { payBeneficiary } from "../src/lib/tax-route.ts";
import { createSquareResolver } from "../scripts/square-post.mjs";
import {
  BSC_USDT,
  createBinanceGiving,
  merchantApi,
} from "../scripts/binance-giving.mjs";
import { normalizeCandles } from "../scripts/gmgn-market.mjs";
function temporary(t) {
  const dir = mkdtempSync(join(tmpdir(), "dark-giving-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test("USDT launch recipients must match the intended settlement rail", () => {
  const target = {
    rail: "binance-pay",
    chainId: 56,
    asset: BSC_USDT,
    address: Wallet.createRandom().address,
  };
  assert.equal(payBeneficiary(target, BSC_USDT), target.address);
  const x = { ...target, rail: "xmoney-tax" };
  assert.equal(payBeneficiary(x, BSC_USDT, "xmoney-tax"), target.address);
  assert.throws(() => payBeneficiary(x, ZeroAddress, "xmoney-tax"));
  assert.throws(() => payBeneficiary(x, BSC_USDT));
  assert.throws(() => payBeneficiary(target, BSC_USDT, "xmoney-tax"));
  assert.throws(() => payBeneficiary({ ...target, chainId: 1 }, BSC_USDT));
});
test("Signed Square author binding survives restart; ordinary posts require a matching live declaration", async (t) => {
  const directory = temporary(t),
    wallet = Wallet.createRandom(),
    profile = "https://www.binance.com/en/square/profile/creator",
    base = "https://www.binance.com/en/square/post/";
  const claim = squareStatement(profile, wallet.address),
    signed = claim + "\nSignature: " + (await wallet.signMessage(claim));
  const posts = new Map();
  function put(id, body, author = profile, identifier = "a1", date = 1) {
    const article = {
      "@type": "SocialMediaPosting",
      url: base + id,
      author: { "@type": "Person", url: author, identifier },
      datePublished: new Date(1700000000000 + date * 86400000).toISOString(),
      articleBody: body,
    };
    posts.set(
      id,
      "<script type='application/ld+json'>" +
        JSON.stringify(article) +
        "</script>",
    );
  }
  const fetcher = async (url) => {
    const body = posts.get(url.split("/").pop());
    return body ? new Response(body) : new Response(null, { status: 202 });
  };
  const resolver = () => createSquareResolver({ directory, fetcher });
  put("2", "Ordinary post");
  await assert.rejects(resolver()(base + "2"), /POST_PAYOUT_NOT_BOUND/);
  put("1", signed);
  assert.equal(
    (await resolver()(base + "1", { declarationOnly: true })).address,
    wallet.address,
  );
  const resolved = await resolver()(base + "2");
  assert.equal(resolved.proof, base + "1");
  assert.equal(resolved.address, wallet.address);
  await assert.rejects(resolver()(base + "2", { declarationOnly: true }));
  put("3", signed, profile + "-other");
  await assert.rejects(resolver()(base + "3"));
  put("4", "Ordinary post", profile, "a2");
  await assert.rejects(resolver()(base + "4"));
  put("5", signed.replace(wallet.address, Wallet.createRandom().address));
  await assert.rejects(resolver()(base + "5"));
  const second = Wallet.createRandom(),
    next = squareStatement(profile, second.address);
  put(
    "6",
    next + "\nSignature: " + (await second.signMessage(next)),
    profile,
    "a1",
    2,
  );
  assert.equal((await resolver()(base + "6")).address, second.address);
  await assert.rejects(resolver()(base + "1"), /POST_PAYOUT_NOT_BOUND/);
  posts.delete("6");
  await assert.rejects(resolver()(base + "2"), /POST_AUTHOR_UNVERIFIED/);
  await assert.rejects(resolver()("https://example.org/en/square/post/1"));
});
test("Merchant payout is bounded, deduplicated and reconciled across timeout, restart, and concurrent workers", async (t) => {
  const dir = temporary(t),
    branch = Wallet.createRandom().neuter();
  const env = {
    BINANCE_PAY_KEY: "demo-certificate",
    BINANCE_PAY_SECRET: "fixture",
    GIVING_COLLECTION_XPUB: branch.extendedKey,
    GIVING_STORE_KEY: randomBytes(32).toString("hex"),
    GIVING_PAYOUT_MAX_USDT: "2",
  };
  let height = 20,
    outcome = "AWAITING_RECEIPT",
    substitute = false;
  const logs = [],
    requests = [],
    sender = Wallet.createRandom().address;
  const token = new Interface([
    "event Transfer(address indexed from,address indexed to,uint256 value)",
  ]);
  function deposit(from, to, amount, idx = logs.length) {
    const event = token.encodeEventLog("Transfer", [
      from,
      to,
      parseEther(amount),
    ]);
    return {
      ...event,
      address: BSC_USDT,
      index: idx,
      blockNumber: height,
      transactionHash: "0x" + String(idx).padStart(64, "0"),
    };
  }
  const provider = {
    getNetwork: async () => ({ chainId: 56n }),
    getBlock: async (tag) => {
      assert.equal(tag, "finalized");
      return { number: height };
    },
    getLogs: async (f) =>
      logs.filter(
        (l) =>
          l.blockNumber >= f.fromBlock &&
          l.blockNumber <= f.toBlock &&
          l.topics[2].toLowerCase() === f.topics[2].toLowerCase(),
      ),
  };
  const request = async (action, d) => {
    if (action === "receiver/check") return d.receiverId !== "999";
    if (action === "transfer") {
      requests.push(d);
      throw Error("response lost after acceptance");
    }
    const orig = requests.find((b) => b.requestId === d.requestId);
    return {
      requestId: d.requestId,
      currency: "USDT",
      transferDetailList: [
        {
          merchantSendId: d.requestId,
          receiver: substitute ? "999" : orig.transferDetailList[0].receiver,
          amount: String(orig.totalAmount),
          receiveType: "BINANCE_ID",
          status:
            requests.indexOf(orig) > 0 && outcome === "SUCCESS"
              ? "AWAITING_RECEIPT"
              : outcome,
        },
      ],
    };
  };
  const service = () =>
    createBinanceGiving(env, {
      dir,
      provider,
      request,
      readArticle: async () => ({
        profile: "https://www.binance.com/en/square/profile/creator",
        authorId: "creator-id",
      }),
    });
  const first = service();
  const uid = "57482364198765";
  const [one, two] = await Promise.all([first.bind(uid), first.bind(uid)]);
  assert.equal(one.address, two.address);
  const other = await first.bind("215");
  await assert.rejects(first.bind("999"));
  await assert.rejects(
    first.bind("https://www.binance.com/en/square/post/700"),
  );
  writeFileSync(
    join(dir, "verified-posts.json"),
    JSON.stringify({
      700: { uid, verifiedAt: "2026-11-19", evidence: "offline fixture" },
    }),
  );
  assert.equal(
    (await first.bind("https://www.binance.com/en/square/post/700")).address,
    one.address,
  );
  height++;
  const credit = deposit(sender, one.address, "3.765432198");
  logs.push(credit, credit, deposit(other.address, one.address, "20"), {
    ...deposit(sender, one.address, "10"),
    removed: true,
  });
  await first.tick();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].totalAmount, 2);
  assert.equal(first.status(one.address).received, "3.765432198");
  assert.equal(first.status(one.address).paid, "0.0");
  first.close();
  assert.equal(
    readFileSync(join(dir, "ledger.sqlite")).includes(Buffer.from(uid)),
    false,
  );
  const left = service(),
    right = service();
  t.after(() => {
    left.close();
    right.close();
  });
  outcome = "SUCCESS";
  substitute = true;
  await left.tick();
  assert.equal(left.status(one.address).paid, "0.0");
  substitute = false;
  await Promise.all([left.tick(), right.tick()]);
  assert.equal(left.status(one.address).paid, "2.0");
  await Promise.all([left.tick(), right.tick()]);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].totalAmount, 1.765432);
  outcome = "FAIL";
  await left.tick();
  await right.tick();
  assert.equal(requests.length, 2);
  assert.equal(left.status(one.address).pending, "failed");
  assert.equal(left.status(one.address).paid, "2.0");
  assert.equal(createBinanceGiving({}).enabled, false);
});
test("Merchant transport signs the exact JSON and canonical endpoint", async () => {
  const env = {
    BINANCE_PAY_KEY: "certificate",
    BINANCE_PAY_SECRET: "test-only",
  };
  const pay = merchantApi(env, async (url, init) => {
    assert.equal(
      url,
      "https://bpay.binanceapi.com/binancepay/openapi/payout/receiver/check",
    );
    const h = init.headers;
    assert.equal(
      h["BinancePay-Signature"],
      createHmac("sha512", env.BINANCE_PAY_SECRET)
        .update(
          h["BinancePay-Timestamp"] +
            "\n" +
            h["BinancePay-Nonce"] +
            "\n" +
            init.body +
            "\n",
        )
        .digest("hex")
        .toUpperCase(),
    );
    return Response.json({ status: "SUCCESS", code: "000000", data: true });
  });
  assert.equal(
    await pay("receiver/check", {
      receiveType: "BINANCE_ID",
      receiverId: "42",
    }),
    true,
  );
});
test("GMGN normalizes seconds and milliseconds without synthesizing candles", () => {
  const bar = {
    time: 1700000000,
    open: "1",
    high: "2",
    low: "0.5",
    close: "1.5",
    volume: "20",
  };
  const rows = normalizeCandles({
    list: [
      { ...bar, time: 1700000060000 },
      bar,
      { ...bar, volume: -1 },
      { ...bar, open: 5 },
      null,
    ],
  });
  assert.deepEqual(
    rows.map((r) => r.time),
    [1700000000, 1700000060],
  );
  assert.equal(rows[0].volume, 20);
});

test("Ordinary posts and Binance UID converge without an author signature; revoked or changed mappings cannot launch", async (t) => {
  const dir = temporary(t),
    profile = "https://www.binance.com/en/square/profile/creator",
    post = "https://www.binance.com/en/square/post/8172",
    uid = "90823412";
  const env = {
    BINANCE_PAY_KEY: "fixture-cert",
    BINANCE_PAY_SECRET: "fixture-secret",
    GIVING_COLLECTION_XPUB: Wallet.createRandom().neuter().extendedKey,
    GIVING_STORE_KEY: randomBytes(32).toString("hex"),
    GIVING_PAYOUT_MAX_USDT: "5",
  };
  let authorId = "42",
    live = true,
    ok = true;
  const requests = [];
  const service = createBinanceGiving(env, {
    dir,
    readArticle: async () => {
      if (!live) throw Error();
      return {
        profile,
        authorId,
        body: "Ordinary post about lunch. Binance UID 111111.",
      };
    },
    provider: {
      getNetwork: async () => ({ chainId: 56n }),
      getBlock: async () => ({ number: 120 }),
    },
    request: async (action, data) => {
      assert.equal(action, "receiver/check");
      requests.push(data.receiverId);
      return ok;
    },
  });
  t.after(() => service.close());
  const record = {
    squareAuthorId: authorId,
    uid,
    verifiedAt: "2026-11-18",
    evidence: "private operator-reviewed test receipt",
  };
  function set(record) {
    writeFileSync(
      join(dir, "verified-authors.json"),
      JSON.stringify({ [profile]: record }),
    );
  }
  assert.equal((await service.check(post)).state, "POST_NOT_LINKED");
  assert.deepEqual(requests, []);
  set(record);
  const preview = await service.check(post);
  assert.equal(preview.state, "READY");
  assert.equal(preview.profile, profile);
  assert.ok(!JSON.stringify(preview).includes(uid));
  assert.deepEqual(requests, [uid]);
  const target = await service.bind(post, preview.ticket),
    uidCheck = await service.check(uid);
  assert.equal(
    (await service.bind(uid, uidCheck.ticket)).address,
    target.address,
  );
  assert.ok(!JSON.stringify(target).includes(uid));
  assert.equal(
    (
      await service.bind(
        "https://www.binance.com/zh-CN/square/post/8172?ref=123",
        preview.ticket,
      )
    ).address,
    target.address,
  );
  await assert.rejects(
    service.bind("https://www.binance.com/en/square/post/8173", preview.ticket),
    /RECIPIENT_CHANGED/,
  );
  const exactFile = join(dir, "verified-posts.json");
  writeFileSync(
    exactFile,
    JSON.stringify({ 8172: { ...record, uid: "94321" } }),
  );
  await assert.rejects(service.check(post), /POST_NOT_LINKED/);
  rmSync(exactFile);
  set({ ...record, uid: "94321" });
  await assert.rejects(service.bind(post, preview.ticket), /RECIPIENT_CHANGED/);
  set({ ...record, revokedAt: "2026-11-19" });
  await assert.rejects(service.check(post), /POST_NOT_LINKED/);
  set(record);
  authorId = "reassigned";
  assert.equal((await service.check(post)).state, "POST_NOT_LINKED");
  authorId = "";
  assert.equal((await service.check(post)).state, "POST_NOT_LINKED");
  live = false;
  await assert.rejects(service.check(post), /POST_AUTHOR_UNVERIFIED/);
  ok = false;
  await assert.rejects(service.bind(uid, uidCheck.ticket), /UID_NOT_VALIDATED/);
  await assert.rejects(
    service.check("https://example.org/square/post/8172"),
    /INVALID_RECIPIENT/,
  );
});
