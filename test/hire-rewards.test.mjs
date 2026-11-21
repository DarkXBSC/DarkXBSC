import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ganache from "ganache";
import {
  BrowserProvider,
  Contract,
  ContractFactory,
  Wallet,
  ZeroAddress,
  id,
  parseEther,
} from "ethers";
import { entryMessage } from "../scripts/hire-rewards.mjs";
const artifact = (n) => JSON.parse(fs.readFileSync("artifacts/" + n + ".json"));
let chain, p, issuer, stranger, author, gate;
async function deploy(n, args) {
  const a = artifact(n);
  const c = await new ContractFactory(
    a.abi,
    a.evm.bytecode.object,
    issuer,
  ).deploy(...args);
  await c.waitForDeployment();
  return c;
}
const agent = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F";
const done = async (tx) => (await tx).wait();
async function signature(vault, key, line, w = author) {
  const e = entryMessage({ key, vault: vault.target }, w.address, line);
  return w.signTypedData(e.domain, e.types, e.value);
}
before(async () => {
  chain = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: 56, hardfork: "shanghai" },
  });
  p = new BrowserProvider(chain, 56, { cacheTimeout: -1 });
  p.pollingInterval = 30;
  issuer = await p.getSigner(0);
  stranger = await p.getSigner(1);
  author = Wallet.createRandom();
  await chain.request({
    method: "evm_setAccountCode",
    params: [agent, "0x" + artifact("TestAgent").evm.deployedBytecode.object],
  });
  gate = new Contract(agent, artifact("TestAgent").abi, issuer);
  await done(gate.grant(author.address));
});
after(async () => {
  p.destroy();
  await chain.disconnect();
});
test("native net revenue split, competing budgets, issuer-only selection, authenticated receipt and replay", async () => {
  const issuerAddr = await issuer.getAddress(),
    v = await deploy("TigerCommissionVault", [
      issuerAddr,
      ZeroAddress,
      issuerAddr,
      2500,
    ]);
  await done(issuer.sendTransaction({ to: v.target, value: parseEther("1") }));
  assert.deepEqual(Array.from(await v.available()), [
    parseEther(".25"),
    parseEther(".75"),
  ]);
  const key = id("brief"),
    other = id("brief2"),
    until = (await p.getBlock("latest")).timestamp + 10000,
    amount = parseEther(".2");
  await done(v.open(key, amount, until));
  await assert.rejects(v.open(other, parseEther(".1"), until));
  await assert.rejects(v.open(key, 1, until));
  await done(v.withdrawIssuer(parseEther(".75")));
  assert.equal(await v.reserved(), amount);
  await assert.rejects(v.withdrawIssuer(1));
  const sig = await signature(v, key, "Signed work");
  await assert.rejects(
    v.connect(stranger).award(key, author.address, "Signed work", sig),
  );
  await assert.rejects(v.award(key, author.address, "Changed", sig));
  const outsider = Wallet.createRandom();
  await assert.rejects(
    v.award(
      key,
      outsider.address,
      "Signed work",
      await signature(v, key, "Signed work", outsider),
    ),
  );
  await done(v.award(key, author.address, "Signed work", sig));
  assert.equal(await p.getBalance(author.address), amount);
  assert.equal((await v.budgets(key)).captionHash, id("Signed work"));
  assert.equal(await v.reserved(), 0n);
  assert.equal((await v.available())[0], parseEther(".05"));
  await assert.rejects(v.award(key, author.address, "Signed work", sig));
  await assert.rejects(v.expire(key));
});
test("six-decimal quote, failed transfer rolls back; retry pays exactly once, expiry returns to giving", async () => {
  const owner = await issuer.getAddress(),
    q = await deploy("TestToken", ["Tax Quote", 6]),
    v = await deploy("TigerCommissionVault", [owner, q.target, owner, 6000]);
  await done(q.transfer(v.target, 1000000));
  const start = (await p.getBlock("latest")).timestamp;
  const key = id("erc20"),
    expired = id("expires");
  await done(v.open(key, 200000, start + 10000));
  await done(v.open(expired, 300000, start + 50));
  const sig = await signature(v, key, "A caption");
  await done(q.setTax(200));
  await assert.rejects(v.award(key, author.address, "A caption", sig));
  assert.equal((await v.budgets(key)).settledBlock, 0n);
  assert.equal(await v.reserved(), 500000n);
  await done(q.setTax(0));
  await done(v.award(key, author.address, "A caption", sig));
  assert.equal(await q.balanceOf(author.address), 200000n);
  await chain.request({ method: "evm_increaseTime", params: [100] });
  await chain.request({ method: "evm_mine", params: [] });
  await assert.rejects(
    v.award(
      expired,
      author.address,
      "A caption",
      await signature(v, expired, "A caption"),
    ),
  );
  await done(v.connect(stranger).expire(expired));
  assert.equal((await v.available())[0], 400000n);
  assert.equal(await v.reserved(), 0n);
  await assert.rejects(v.expire(expired));
});
