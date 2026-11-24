import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Interface, getBytes } from "ethers";
import {
  RailgunEngine,
  getPublicViewingKey,
  ShieldNote,
} from "@railgun-community/engine";
import { getSharedSymmetricKey } from "../node_modules/@railgun-community/engine/dist/utils/keys-utils.js";
import {
  createShieldCall,
  validateRailgunAddress,
} from "../src/lib/railgun-crypto.mjs";
import { railgunNetwork, railgunAbi } from "../src/lib/railgun-config.mjs";

const bsc = railgunNetwork("bsc");
const receiver = randomBytes(32);
const keys = {
  masterPublicKey: 1723n,
  viewingPublicKey: await getPublicViewingKey(receiver),
};
const address = RailgunEngine.encodeAddress(keys);
const params = {
  chain: "bsc",
  address,
  token: bsc.wrapped,
  amount: "1000000000000000000",
};

test("only BSC and valid, compatible 0zk recipients can be used", async () => {
  assert.throws(() => railgunNetwork("base"));
  assert.throws(() => validateRailgunAddress("0x" + "0".repeat(40), "bsc"));
  assert.throws(
    () =>
      validateRailgunAddress(
        RailgunEngine.encodeAddress({ ...keys, chain: { type: 0, id: 8453 } }),
        "bsc",
      ),
    /ADDRESS_NETWORK/,
  );
  assert.throws(() =>
    validateRailgunAddress(
      RailgunEngine.encodeAddress({
        ...keys,
        viewingPublicKey: new Uint8Array(32),
      }),
      "bsc",
    ),
  );
  assert.doesNotThrow(() =>
    validateRailgunAddress(
      RailgunEngine.encodeAddress({ ...keys, chain: { type: 0, id: 56 } }),
      "bsc",
    ),
  );
  await assert.rejects(createShieldCall({ ...params, amount: "0" }));
  await assert.rejects(
    createShieldCall({ ...params, token: "0x" + "0".repeat(40) }),
  );
});
test("recipient can decrypt a fresh note and recover its exact commitment", async () => {
  const a = await createShieldCall(params),
    b = await createShieldCall(params);
  assert.notEqual(a.npk, b.npk);
  assert.equal(a.to, bsc.proxy);
  assert.equal(a.value, "0");
  const [[note]] = new Interface(railgunAbi).decodeFunctionData(
    "shield",
    a.data,
  );
  const shared = await getSharedSymmetricKey(
    receiver,
    getBytes(note.ciphertext.shieldKey),
  );
  const random = ShieldNote.decryptRandom(
    note.ciphertext.encryptedBundle,
    shared,
  );
  assert.equal(
    ShieldNote.getNotePublicKey(keys.masterPublicKey, random),
    BigInt(a.npk),
  );
  assert.equal(note.preimage.value, BigInt(params.amount));
  assert.equal(note.preimage.token.tokenAddress.toLowerCase(), bsc.wrapped);
});
test("native deposits wrap and shield the same amount in an atomic relay call", async () => {
  const tx = await createShieldCall({ ...params, native: true });
  assert.equal(tx.to, bsc.relay);
  assert.equal(tx.value, params.amount);
  const iface = new Interface([
    "function wrapBase(uint256)",
    "function multicall(bool,(address to,bytes data,uint256 value)[])",
  ]);
  const [requireSuccess, calls] = iface.decodeFunctionData(
    "multicall",
    tx.data,
  );
  assert(requireSuccess);
  assert.equal(calls.length, 2);
  assert(calls.every((c) => c.to === bsc.relay && c.value === 0n));
  assert.equal(
    iface.decodeFunctionData("wrapBase", calls[0].data)[0],
    BigInt(params.amount),
  );
  const [[request]] = new Interface(railgunAbi).decodeFunctionData(
    "shield",
    calls[1].data,
  );
  assert.equal(request.preimage.value, BigInt(params.amount));
});
