import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Wallet, id, ZeroAddress, Interface } from "ethers";
import { PAY_NETWORK } from "../src/lib/agent-pay.ts";
import { createHireBoard } from "../scripts/hire-board.mjs";
test("signed brief is discoverable only after escrow; private selection cannot bypass payment; confirmed award recovers after restart", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hire-paid-")),
    owner = Wallet.createRandom(),
    author = Wallet.createRandom(),
    other = Wallet.createRandom(),
    token = Wallet.createRandom().address,
    vault = Wallet.createRandom().address;
  const identity = {
    current: async (a) =>
      a === author.address
        ? "river.ai"
        : a === other.address
          ? "other.ai"
          : null,
    attest: async (a) =>
      a === author.address
        ? {
            wallet: a,
            name: "river.ai",
            block: 12,
            registry: PAY_NETWORK.agentId,
          }
        : null,
    owner: async (h) => (h === "river.ai" ? author.address : null),
    block: async () => 1,
  };
  let state = { state: "funding" };
  const chain = {
    info: async () => ({
      owner: owner.address,
      token,
      vault,
      asset: ZeroAddress,
      symbol: "BNB",
      decimals: 18,
      available: "100000000000000000",
      creator: "0",
    }),
    status: async () => state,
  };
  const start = () =>
    createHireBoard({
      db: new DatabaseSync(join(dir, "data")),
      editor: owner.address,
      identity,
      rewardChain: chain,
    });
  let board = start();
  t.after(() => {
    board.close();
    rmSync(dir, { recursive: true });
  });
  const origin = "https://darkwork.fun";
  async function sign(w, input) {
    const req = await board.challenge({ ...input, address: w.address }, origin),
      { EIP712Domain, ...types } = req.data.types;
    return board.commit(
      {
        id: req.id,
        signature: await w.signTypedData(
          req.data.domain,
          types,
          req.data.message,
        ),
      },
      origin,
    );
  }
  const terms = {
    kind: "post",
    title: "Book drive",
    body: "Write an invitation",
    consent: true,
    target: "river.ai",
    reward: { token, amount: "0.01" },
  };
  await assert.rejects(sign(author, terms), /HIRE_OWNER/);
  await assert.rejects(
    sign(owner, { ...terms, reward: { token, amount: "1" } }),
    /REWARD_BALANCE/,
  );
  const { brief } = await sign(owner, terms),
    submission = {
      kind: "submit",
      brief,
      line: "Bring a book.",
      visitor: randomUUID(),
    };
  assert.equal(board.board().length, 0);
  await assert.rejects(sign(author, submission), /REWARD_STATE/);
  state = { state: "open" };
  await board.rewards.sync(brief);
  assert.equal(board.board()[0].reward.display, "0.01");
  await assert.rejects(sign(other, { kind: "accept", brief }), /INVITED_ONLY/);
  await assert.rejects(sign(owner, { kind: "accept", brief }), /ID_REQUIRED/);
  await sign(author, { kind: "accept", brief });
  await sign(author, { kind: "accept", brief });
  assert.equal(board.detail(brief).applicants, 1);
  const { entry } = await sign(author, submission);
  assert.equal(board.detail(brief).applicants, 1);
  await assert.rejects(
    sign(owner, { kind: "select", brief, entry }),
    /REWARD_ONCHAIN/,
  );
  const request = board.rewards.action(brief, "award", entry),
    iface = new Interface(["function award(bytes32,address,string,bytes)"]);
  assert.equal(request.to, vault);
  assert.equal(
    iface.decodeFunctionData("award", request.data)[1],
    author.address,
  );
  assert.equal(board.detail(brief).selected, null);
  board.close();
  board = start();
  state = {
    state: "paid",
    author: author.address,
    work: id(submission.line),
    hash: id("receipt"),
  };
  await Promise.all([board.rewards.sync(brief), board.rewards.sync(brief)]);
  assert.equal(board.detail(brief).selected, entry);
  assert.equal(board.detail(brief).reward.tx, state.hash);
  assert.throws(
    () => board.rewards.action(brief, "award", entry),
    /REWARD_STATE/,
  );
  const stamp = await identity.attest(author.address);
  assert.equal(
    board.portfolio.profile(stamp, new URLSearchParams()).totals.paid,
    0,
  );
  await sign(author, { kind: "showcase", entry });
  assert.equal(board.portfolio.card(entry).tx, state.hash);
  assert.equal(
    board.portfolio.profile(stamp, new URLSearchParams()).totals.paid,
    1,
  );
});
