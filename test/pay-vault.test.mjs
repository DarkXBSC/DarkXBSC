import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ganache from "ganache";
import {
  BrowserProvider,
  ContractFactory,
  Wallet,
  keccak256,
  toUtf8Bytes,
  concat,
} from "ethers";
let rpc,
  provider,
  owner,
  agent,
  recipient,
  verifier,
  token,
  vault,
  serial = 0;
const units = 1_000_000n,
  hash = (s) => keccak256(toUtf8Bytes(s));
const types = {
  AgentLease: [
    { name: "agent", type: "address" },
    { name: "epoch", type: "uint256" },
    { name: "attestorEpoch", type: "uint256" },
    { name: "issuedAt", type: "uint256" },
    { name: "validUntil", type: "uint256" },
  ],
};
const tx = async (p) => (await p).wait();
const now = async () => Number((await provider.getBlock("latest")).timestamp);
async function deploy(name, args) {
  const a = JSON.parse(
    fs.readFileSync("artifacts/experimental/" + name + ".json"),
  );
  const c = await new ContractFactory(
    a.abi,
    a.evm.bytecode.object,
    owner,
  ).deploy(...args);
  await c.waitForDeployment();
  return c;
}
async function signature(over = {}, domainOver = {}) {
  const a = await vault.agents(agent.address),
    issuedAt = await now();
  const value = {
    agent: agent.address,
    epoch: a.epoch,
    attestorEpoch: await vault.attestorEpoch(),
    issuedAt,
    validUntil: issuedAt + 300,
    ...over,
  };
  const sig = await verifier.signTypedData(
    {
      name: "DarkPayoutVault",
      version: "1",
      chainId: 8453,
      verifyingContract: await vault.getAddress(),
      ...domainOver,
    },
    types,
    value,
  );
  return { value, sig };
}
async function lease() {
  const { value: v, sig } = await signature();
  await tx(vault.activateLease(agent.address, v.issuedAt, v.validUntil, sig));
}
async function campaign(amount = 10n * units, options = {}) {
  const id = hash("campaign-" + ++serial);
  const p = {
    index: 0,
    recipient: await recipient.getAddress(),
    amount,
    receiptRef: hash("random-test-ref-" + serial),
    proof: [],
  };
  const leaf = await vault.paymentLeaf(
    id,
    p.index,
    p.recipient,
    p.amount,
    p.receiptRef,
  );
  await tx(
    vault.openCampaign(
      id,
      leaf,
      options.cap || amount,
      options.per || amount,
      (await now()) + 3600,
    ),
  );
  return { id, p };
}
before(async () => {
  rpc = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: 8453, hardfork: "shanghai" },
    wallet: { totalAccounts: 5 },
  });
  provider = new BrowserProvider(rpc, undefined, { cacheTimeout: -1 });
  [owner, agent, recipient] = await Promise.all(
    [0, 1, 2].map((i) => provider.getSigner(i)),
  );
  verifier = new Wallet(Object.values(rpc.getInitialAccounts())[3].secretKey);
});
beforeEach(async () => {
  token = await deploy("TestToken", ["USDC", 6]);
  vault = await deploy("DarkPayoutVault", [
    await token.getAddress(),
    await owner.getAddress(),
    verifier.address,
  ]);
  await tx(token.transfer(await vault.getAddress(), 1000n * units));
  await tx(vault.configureAgent(agent.address, 100n * units));
  await lease();
});
after(async () => {
  await provider.destroy();
  await rpc.disconnect();
});
test("approved operator pushes exact USDC without recipient claim and prevents replay", async () => {
  const { id, p } = await campaign();
  await tx(vault.connect(agent).payBatch(id, [p]));
  assert.equal(await token.balanceOf(p.recipient), p.amount);
  assert.equal(await vault.paid(id, 0), true);
  await assert.rejects(() => vault.connect(agent).payBatch(id, [p]));
  assert.equal((await vault.campaigns(id)).spent, p.amount);
});
test("unapproved recipient and unleased sender cannot spend", async () => {
  const { id, p } = await campaign();
  await assert.rejects(() =>
    vault.connect(agent).payBatch(id, [{ ...p, recipient: owner.address }]),
  );
  await assert.rejects(() => vault.payBatch(id, [p]));
  assert.equal(await vault.paid(id, 0), false);
});
test("campaign, per-payment and cumulative daily caps are enforced", async () => {
  const a = await campaign(15n * units, { cap: 20n * units, per: 10n * units });
  await assert.rejects(() => vault.connect(agent).payBatch(a.id, [a.p]));
  const b = await campaign(30n * units, { cap: 20n * units, per: 20n * units });
  await assert.rejects(() => vault.connect(agent).payBatch(b.id, [b.p]));
  const c = await campaign(60n * units);
  await tx(vault.connect(agent).payBatch(c.id, [c.p]));
  const d = await campaign(50n * units);
  await assert.rejects(() => vault.connect(agent).payBatch(d.id, [d.p]));
});
test("bad second proof rolls back an entire batch including first transfer", async () => {
  const id = hash("pair" + ++serial),
    to = recipient.address;
  const p = [0, 1].map((index) => ({
    index,
    recipient: to,
    amount: units,
    receiptRef: hash("pair-ref-" + index),
    proof: [],
  }));
  const l = await Promise.all(
    p.map((x) =>
      vault.paymentLeaf(id, x.index, x.recipient, x.amount, x.receiptRef),
    ),
  );
  const root = keccak256(concat([...l].sort()));
  p[0].proof = [l[1]];
  p[1].proof = [l[0]];
  await tx(
    vault.openCampaign(
      id,
      root,
      10n * units,
      10n * units,
      (await now()) + 3600,
    ),
  );
  await assert.rejects(() =>
    vault.connect(agent).payBatch(id, [p[0], { ...p[1], amount: 2n * units }]),
  );
  assert.equal(await vault.paid(id, 0), false);
  assert.equal(await token.balanceOf(to), 0n);
  await tx(vault.connect(agent).payBatch(id, p));
  assert.equal(await token.balanceOf(to), 2n * units);
});
test("lease rejects another chain, expired/future or overlong attestations", async () => {
  for (const [over, dom] of [
    [{}, { chainId: 56 }],
    [{ issuedAt: (await now()) + 10 }, {}],
    [{ validUntil: (await now()) - 1 }, {}],
    [{ validUntil: (await now()) + 601 }, {}],
  ]) {
    const { value: v, sig } = await signature(over, dom);
    await assert.rejects(() =>
      vault.activateLease(agent.address, v.issuedAt, v.validUntil, sig),
    );
  }
});
test("agent revocation and attestor rotation invalidate old leases and signatures", async () => {
  const old = await signature();
  await tx(vault.configureAgent(agent.address, 100n * units));
  await assert.rejects(() =>
    vault.activateLease(
      agent.address,
      old.value.issuedAt,
      old.value.validUntil,
      old.sig,
    ),
  );
  await lease();
  const { id, p } = await campaign();
  await tx(vault.setAttestor(owner.address));
  await assert.rejects(() => vault.connect(agent).payBatch(id, [p]));
});
test("pause, close and immutable-dev rescue stop payouts and disclose unfunded commitments", async () => {
  const { id, p } = await campaign();
  await tx(vault.setPaused(true));
  await assert.rejects(() => vault.connect(agent).payBatch(id, [p]));
  await tx(vault.setPaused(false));
  await tx(vault.closeCampaign(id));
  await assert.rejects(() => vault.connect(agent).payBatch(id, [p]));
  await assert.rejects(async () =>
    vault.connect(agent).rescue(await token.getAddress()),
  );
  await tx(vault.rescue(await token.getAddress()));
  assert.equal(await token.balanceOf(await vault.getAddress()), 0n);
  assert.equal(await vault.paused(), true);
});
test("taxed token behavior cannot produce a paid receipt", async () => {
  const { id, p } = await campaign();
  await tx(token.setTax(100));
  await assert.rejects(() => vault.connect(agent).payBatch(id, [p]));
  assert.equal(await vault.paid(id, 0), false);
  assert.equal((await vault.campaigns(id)).spent, 0n);
});
