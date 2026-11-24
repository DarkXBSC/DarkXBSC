// Narrow imports from the pinned, unmodified official Engine. No spending key,
// private wallet database, remote prover, or recipient API is used by shielding.
import {
  decodeAddress,
  encodeAddress,
} from "../../node_modules/@railgun-community/engine/dist/key-derivation/bech32.js";
import { ShieldNoteERC20 } from "../../node_modules/@railgun-community/engine/dist/note/erc20/shield-note-erc20.js";
import { initPoseidonPromise } from "../../node_modules/@railgun-community/engine/dist/utils/poseidon.js";
import { initCurve25519Promise } from "../../node_modules/@railgun-community/engine/dist/utils/scalar-multiply.js";
import { Point } from "@noble/ed25519";
import { Interface, hexlify, randomBytes } from "ethers";
import {
  railgunNetwork,
  railgunAbi,
  shieldAmounts,
} from "./railgun-config.mjs";

export function validateRailgunAddress(address, chain) {
  const network = railgunNetwork(chain);
  try {
    // Do not silently lowercase or truncate a mixed-case/invalid address.
    if (address.length !== 127 || !address.startsWith("0zk1")) throw Error();
    const data = decodeAddress(address);
    if (
      encodeAddress(data) !== address ||
      data.viewingPublicKey.length !== 32 ||
      data.masterPublicKey <= 0n ||
      data.masterPublicKey >=
        21888242871839275222246405745257275088548364400416034343698204186575808495617n
    )
      throw Error();
    const viewing = Point.fromHex(data.viewingPublicKey);
    if (viewing.equals(Point.ZERO) || !viewing.isTorsionFree()) throw Error();
    if (data.chain && (data.chain.type !== 0 || data.chain.id !== network.id))
      throw Error("RAILGUN_ADDRESS_NETWORK");
    return data;
  } catch (e) {
    if (e.message === "RAILGUN_ADDRESS_NETWORK") throw e;
    throw Error("INVALID_RAILGUN_ADDRESS");
  }
}
export async function createShieldCall({
  chain,
  address,
  token,
  amount,
  native = false,
}) {
  const network = railgunNetwork(chain);
  if (
    !network.assets.some((a) => a.address.toLowerCase() === token.toLowerCase())
  )
    throw Error("RAILGUN_ASSET_UNSUPPORTED");
  shieldAmounts(BigInt(amount), 0n);
  const recipient = validateRailgunAddress(address, chain);
  await Promise.all([initPoseidonPromise, initCurve25519Promise]);
  const ephemeralKey = randomBytes(32);
  try {
    const note = new ShieldNoteERC20(
      recipient.masterPublicKey,
      hexlify(randomBytes(16)).slice(2),
      BigInt(amount),
      token,
    );
    const request = await note.serialize(
      ephemeralKey,
      recipient.viewingPublicKey,
    );
    const shield = new Interface(railgunAbi).encodeFunctionData("shield", [
      [request],
    ]);
    const npk = String(request.preimage.npk);
    if (!native) return { to: network.proxy, data: shield, value: "0", npk };
    if (token.toLowerCase() !== network.wrapped)
      throw Error("RAILGUN_ASSET_UNSUPPORTED");
    const relay = new Interface([
      "function wrapBase(uint256)",
      "function multicall(bool,(address to,bytes data,uint256 value)[])",
    ]);
    const calls = [
      [network.relay, relay.encodeFunctionData("wrapBase", [amount]), 0n],
      [network.relay, shield, 0n],
    ];
    return {
      to: network.relay,
      data: relay.encodeFunctionData("multicall", [true, calls]),
      value: String(amount),
      npk,
    };
  } finally {
    ephemeralKey.fill(0);
  }
}
