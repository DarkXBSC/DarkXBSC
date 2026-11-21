import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ganache from "ganache";
import {
  BrowserProvider,
  ContractFactory,
  Wallet,
  parseEther,
  ZeroAddress,
  keccak256,
  randomBytes,
  hexlify,
  AbiCoder,
} from "ethers";
let server,
  provider,
  owner,
  maker,
  taker,
  stranger,
  fee,
  token,
  quote,
  gate,
  settlement,
  inventory,
  registry;
const amount = 1000n * 10n ** 18n,
  payment = 25n * 10n ** 6n;
const types = {
  Order: [
    { name: "maker", type: "address" },
    { name: "taker", type: "address" },
    { name: "sellToken", type: "address" },
    { name: "buyToken", type: "address" },
    { name: "sellAmount", type: "uint256" },
    { name: "buyAmount", type: "uint256" },
    { name: "expiry", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "agentOnly", type: "bool" },
  ],
};
async function deploy(name, args = []) {
  const a = JSON.parse(fs.readFileSync("artifacts/" + name + ".json"));
  const c = await new ContractFactory(
    a.abi,
    a.evm.bytecode.object,
    owner,
  ).deploy(...args);
  await c.waitForDeployment();
  return c;
}
async function receipt(p) {
  return (await p).wait();
}
async function order(nonce, over = {}) {
  return {
    maker: await maker.getAddress(),
    taker: await taker.getAddress(),
    sellToken: await token.getAddress(),
    buyToken: await quote.getAddress(),
    sellAmount: amount,
    buyAmount: payment,
    expiry: Number((await provider.getBlock("latest")).timestamp) + 3600,
    nonce,
    agentOnly: false,
    ...over,
  };
}
async function sign(o, signer = maker, chainId = 56) {
  return signer.signTypedData(
    {
      name: "TigerSettlement",
      version: "1",
      chainId,
      verifyingContract: await settlement.getAddress(),
    },
    types,
    o,
  );
}
before(async () => {
  server = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: 56, hardfork: "shanghai" },
    wallet: {
      totalAccounts: 8,
      unlockedAccounts: [
        "0x90497450f2a706f1951b5bdda52B4E5d16f34C06",
        "0x9e27098dcD8844bcc6287a557E0b4D09C86B8a4b",
      ],
    },
  });
  provider = new BrowserProvider(server, undefined, { cacheTimeout: -1 });
  const keys = Object.values(server.getInitialAccounts()).map(
    (x) => x.secretKey,
  );
  [owner, maker, taker, stranger, fee] = await Promise.all(
    [0, 1, 2, 3, 4].map((i) => provider.getSigner(i)),
  );
  maker.signTypedData = (d, t, v) => new Wallet(keys[1]).signTypedData(d, t, v);
  token = await deploy("TestToken", ["SELL", 18]);
  quote = await deploy("TestToken", ["USD", 6]);
  gate = await deploy("TestAgent");
  settlement = await deploy("TigerSettlement", [
    await fee.getAddress(),
    await gate.getAddress(),
  ]);
  inventory = await deploy("TigerInventory");
  registry = await deploy("TigerRegistry", [await owner.getAddress()]);
  await receipt(token.transfer(await maker.getAddress(), amount * 100n));
  await receipt(quote.transfer(await taker.getAddress(), payment * 100n));
  await receipt(
    token.connect(maker).approve(await settlement.getAddress(), amount * 100n),
  );
  await receipt(
    quote.connect(taker).approve(await settlement.getAddress(), payment * 100n),
  );
});
after(async () => {
  await server.disconnect();
});
test("OTC exact 6-decimal quote, fee and token amounts; replay rejected", async () => {
  const o = await order(1),
    sig = await sign(o);
  const feeBefore = await quote.balanceOf(await fee.getAddress());
  await receipt(settlement.connect(taker).settle(o, sig, amount));
  assert.equal(await token.balanceOf(await taker.getAddress()), amount);
  assert.equal(await quote.balanceOf(await maker.getAddress()), payment);
  assert.equal(
    (await quote.balanceOf(await fee.getAddress())) - feeBefore,
    (payment * 30n) / 10000n,
  );
  await assert.rejects(
    receipt(settlement.connect(taker).settle(o, sig, amount)),
  );
});
test("wrong taker, wrong chain signature, expired and cancelled quotes fail", async () => {
  let o = await order(2),
    sig = await sign(o);
  await assert.rejects(settlement.connect(stranger).settle(o, sig, 1));
  await assert.rejects(
    settlement.connect(taker).settle(o, await sign(o, maker, 4663), 1),
  );
  await receipt(settlement.connect(maker).cancel(2));
  await assert.rejects(settlement.connect(taker).settle(o, sig, 1));
  o = await order(3, { expiry: 1 });
  await assert.rejects(settlement.connect(taker).settle(o, await sign(o), 1));
});
test("Agent quotes require both identities; ordinary quotes remain permissionless", async () => {
  const o = await order(4, { agentOnly: true }),
    sig = await sign(o);
  await assert.rejects(settlement.connect(taker).settle(o, sig, amount));
  await receipt(gate.grant(await maker.getAddress()));
  await assert.rejects(settlement.connect(taker).settle(o, sig, amount));
  await receipt(gate.grant(await taker.getAddress()));
  await receipt(
    settlement.connect(taker).settle(o, sig, amount, { gasLimit: 500000 }),
  );
  assert.equal(await settlement.nonceUsed(o.maker, 4), true);
});
test("taxed sell assets respect minimum receipt; taxed quote rolls everything back", async () => {
  await receipt(token.setTax(100));
  let o = await order(5),
    sig = await sign(o);
  await assert.rejects(settlement.connect(taker).settle(o, sig, amount));
  await receipt(
    settlement.connect(taker).settle(o, sig, (amount * 99n) / 100n),
  );
  await receipt(quote.setTax(100));
  o = await order(6);
  const before = await token.balanceOf(await maker.getAddress());
  await assert.rejects(settlement.connect(taker).settle(o, await sign(o), 1));
  assert.equal(await settlement.nonceUsed(o.maker, 6), false);
  assert.equal(await token.balanceOf(await maker.getAddress()), before);
  await receipt(token.setTax(0));
  await receipt(quote.setTax(0));
});
test("ERC-1271 smart contract maker signatures", async () => {
  const cm = await deploy("ContractMaker", [await maker.getAddress()]);
  await receipt(token.transfer(await cm.getAddress(), amount));
  await receipt(
    cm
      .connect(maker)
      .approve(await token.getAddress(), await settlement.getAddress(), amount),
  );
  const o = await order(7, { maker: await cm.getAddress() });
  await receipt(settlement.connect(taker).settle(o, await sign(o), amount));
});
test("inventory native lock claims only with secret and pays fixed recipient", async () => {
  const secret = hexlify(randomBytes(32)),
    hash = keccak256(secret),
    expiry = Number((await provider.getBlock("latest")).timestamp) + 1800;
  const tx = await receipt(
    inventory
      .connect(maker)
      .lock(
        ZeroAddress,
        await taker.getAddress(),
        parseEther("1"),
        hash,
        expiry,
        hexlify(randomBytes(32)),
        { value: parseEther("1") },
      ),
  );
  const id = inventory.interface.parseLog(tx.logs[0]).args.id;
  await assert.rejects(inventory.claim(id, hexlify(randomBytes(32))));
  await assert.rejects(inventory.refund(id));
  const before = await provider.getBalance(await taker.getAddress(), "latest");
  await receipt(inventory.connect(stranger).claim(id, secret));
  assert.equal((await inventory.locks(id)).state, 2n);
  assert.equal(await provider.getBalance(await inventory.getAddress()), 0n);
  await assert.rejects(inventory.claim(id, secret));
});
test("inventory ERC20 refund after expiry, rejects fee-on-transfer deposits", async () => {
  await receipt(
    token.connect(maker).approve(await inventory.getAddress(), amount * 2n),
  );
  let expiry = Number((await provider.getBlock("latest")).timestamp) + 601;
  let tx = await receipt(
    inventory
      .connect(maker)
      .lock(
        await token.getAddress(),
        await taker.getAddress(),
        amount,
        keccak256(randomBytes(32)),
        expiry,
        hexlify(randomBytes(32)),
      ),
  );
  const log = tx.logs
    .map((l) => {
      try {
        return inventory.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((l) => l?.name === "Locked");
  await server.request({ method: "evm_increaseTime", params: [602] });
  await server.request({ method: "evm_mine", params: [] });
  await receipt(inventory.connect(stranger).refund(log.args.id));
  assert.equal((await inventory.locks(log.args.id)).state, 3n);
  await receipt(token.setTax(100));
  expiry = Number((await provider.getBlock("latest")).timestamp) + 1800;
  await assert.rejects(
    inventory
      .connect(maker)
      .lock(
        await token.getAddress(),
        await taker.getAddress(),
        amount,
        keccak256(randomBytes(32)),
        expiry,
        hexlify(randomBytes(32)),
      ),
  );
  await receipt(token.setTax(0));
});
test("registry namespaces creators, owner attestations reset on edits", async () => {
  await receipt(
    registry
      .connect(maker)
      .register(
        await token.getAddress(),
        4663,
        await quote.getAddress(),
        "ipfs://metadata",
      ),
  );
  const ids = await registry.page(0, 100);
  assert.equal(ids.length, 1);
  await assert.rejects(
    registry.connect(stranger).update(ids[0], 0, ZeroAddress, ""),
  );
  await assert.rejects(registry.connect(stranger).attest(ids[0], true));
  await receipt(registry.attest(ids[0], true));
  assert.equal((await registry.project(ids[0])).attested, true);
  await receipt(registry.connect(maker).update(ids[0], 0, ZeroAddress, ""));
  assert.equal((await registry.project(ids[0])).attested, false);
});
test("V3 reserve: pre-token initialization, idempotent revenue, rescue and recovery", async () => {
  const predicted = Wallet.createRandom().address;
  const reserve = await deploy("TigerReserve", [
    predicted,
    await quote.getAddress(),
    await maker.getAddress(),
  ]);
  assert.equal(await reserve.vaultSpecVersion(), "v3");
  assert.equal(
    await reserve.description(),
    "Dark reserve active. Accounted quote units: 0",
  );
  const schema = await reserve.vaultUISchema();
  assert.equal(schema.vaultType, "Dark Reserve");
  assert.deepEqual(
    Array.from(schema.methods, (method) => method.name),
    ["accountedQuote", "sync", "withdraw", "rescue", "resume"],
  );
  assert.match(
    schema.methods[3].description,
    /全部余额.*固定的创建者地址.*暂停普通支取/,
  );
  await receipt(quote.transfer(await reserve.getAddress(), 1000000));
  await receipt(reserve.sync());
  await receipt(reserve.sync());
  assert.equal(await reserve.totalRevenue(), 1000000n);
  await assert.rejects(
    reserve.connect(stranger).rescue(await quote.getAddress()),
  );
  await receipt(
    reserve.connect(maker).withdraw(400000, await maker.getAddress()),
  );
  assert.equal(await reserve.accountedQuote(), 600000n);
  await receipt(reserve.connect(maker).rescue(await quote.getAddress()));
  assert.equal(await reserve.accountedQuote(), 0n);
  assert.equal(await reserve.paused(), true);
  await receipt(quote.transfer(await reserve.getAddress(), 200000));
  await receipt(reserve.sync());
  assert.equal(await reserve.totalRevenue(), 1200000n);
  await assert.rejects(
    reserve.connect(maker).withdraw(1, await maker.getAddress()),
  );
  await receipt(reserve.connect(maker).resume());
  await receipt(
    reserve.connect(maker).withdraw(200000, await maker.getAddress()),
  );
  assert.equal(await reserve.accountedQuote(), 0n);
  await receipt(reserve.connect(maker).rescue(await quote.getAddress()));
});
test("factory restricts creation to canonical portal and declares spec", async () => {
  const f = await deploy("TigerReserveFactory");
  assert.equal(await f.factorySpecVersion(), "v2.3");
  const schema = await f.vaultDataSchema();
  assert.equal(
    schema.description,
    "为每枚代币创建独立的税收金库，以所选底池资产记账。无需额外参数。",
  );
  assert.equal(schema.fields.length, 0);
  assert.equal(await f.isQuoteTokenSupported(ZeroAddress), true);
  assert.equal(
    await f.isQuoteTokenSupported(await stranger.getAddress()),
    false,
  );
  await assert.rejects(
    f.newVault(
      Wallet.createRandom().address,
      ZeroAddress,
      await maker.getAddress(),
      "0x",
    ),
  );
});

test("canonical portal creates a V3 reserve before its token exists; duplicate rejected", async () => {
  const portalAddress = "0x90497450f2a706f1951b5bdda52B4E5d16f34C06";
  await server.request({
    method: "evm_setAccountBalance",
    params: [portalAddress, "0x56bc75e2d63100000"],
  });
  const portal = await provider.getSigner(portalAddress);
  const f = await deploy("TigerReserveFactory");
  const predicted = Wallet.createRandom().address;
  await receipt(
    f
      .connect(portal)
      .newVault(predicted, ZeroAddress, await maker.getAddress(), "0x"),
  );
  assert.notEqual(await f.vaultOf(predicted), ZeroAddress);
  assert.equal(await provider.getCode(predicted), "0x");
  await assert.rejects(
    receipt(
      f
        .connect(portal)
        .newVault(predicted, ZeroAddress, await maker.getAddress(), "0x"),
    ),
  );
});
test("native reserve rescue and independent canonical Guardian authority", async () => {
  const guardianAddress = "0x9e27098dcD8844bcc6287a557E0b4D09C86B8a4b";
  await server.request({
    method: "evm_setAccountBalance",
    params: [guardianAddress, "0x56bc75e2d63100000"],
  });
  const guardian = await provider.getSigner(guardianAddress);
  const r = await deploy("TigerReserve", [
    Wallet.createRandom().address,
    ZeroAddress,
    await maker.getAddress(),
  ]);
  await receipt(
    owner.sendTransaction({ to: await r.getAddress(), value: parseEther("1") }),
  );
  assert.equal(await r.accountedQuote(), parseEther("1"));
  await receipt(r.connect(guardian).rescue(ZeroAddress));
  assert.equal(await provider.getBalance(await r.getAddress()), 0n);
  assert.equal(await r.accountedQuote(), 0n);
  await receipt(
    owner.sendTransaction({
      to: await r.getAddress(),
      value: parseEther("0.5"),
    }),
  );
  assert.equal(await r.totalRevenue(), parseEther("1.5"));
  await receipt(r.connect(maker).rescue(ZeroAddress));
  assert.equal(await r.accountedQuote(), 0n);
});
