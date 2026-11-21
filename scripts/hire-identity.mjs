import {
  Contract,
  FetchRequest,
  JsonRpcProvider,
  ZeroAddress,
  getAddress,
} from "ethers";
import { PAY_NETWORK } from "../src/lib/agent-pay.ts";

const abi = [
  "function handleOf(address) view returns(string)",
  "function balanceOf(address) view returns(uint256)",
  "function ownerOfHandle(string) view returns(address)",
];
export function hireIdentity(urls) {
  const providers = [...new Set(urls.filter(Boolean))].map((url) => {
    const req = new FetchRequest(url);
    req.timeout = 4500;
    return new JsonRpcProvider(req, 56, {
      staticNetwork: true,
      cacheTimeout: -1,
    });
  });
  async function read(fn) {
    for (const p of providers) {
      try {
        if (BigInt(await p.send("eth_chainId", [])) !== 56n) continue;
        return await fn(p, new Contract(PAY_NETWORK.agentId, abi, p));
      } catch {
        /* Independent BSC read endpoint. */
      }
    }
    throw Error("HIRE_RPC");
  }
  async function attestation(value, byName) {
    return read(async (p, c) => {
      const latest = await p.send("eth_getBlockByNumber", ["finalized", false]);
      if (!latest?.number) throw Error("HIRE_RPC");
      const block = Number(BigInt(latest.number)),
        at = { blockTag: block };
      const wallet = byName
        ? await c.ownerOfHandle(value.slice(0, -3), at)
        : getAddress(value);
      if (wallet === ZeroAddress) return null;
      const [raw, balance] = await Promise.all([
        c.handleOf(wallet, at),
        c.balanceOf(wallet, at),
      ]);
      if (!raw || balance === 0n) return null;
      const name = raw + ".ai";
      if (byName && name !== value) return null;
      if (!byName && getAddress(await c.ownerOfHandle(raw, at)) !== wallet)
        return null;
      return {
        wallet: getAddress(wallet),
        name,
        block,
        registry: PAY_NETWORK.agentId,
        chainId: 56,
      };
    });
  }
  // Only browsing may reuse a recent finalized checkpoint. Signing always reads the registry again.
  const lookups = new Map();
  function browse(name) {
    const now = Date.now(),
      cached = lookups.get(name);
    if (cached && cached.until > now) return cached.value;
    if (lookups.size >= 256) lookups.delete(lookups.keys().next().value);
    const value = attestation(name, true).catch((e) => {
      if (lookups.get(name)?.value === value) lookups.delete(name);
      throw e;
    });
    lookups.set(name, { value, until: now + 15000 });
    return value;
  }
  return {
    attest(address) {
      return attestation(address, false);
    },
    lookup(name) {
      return browse(name);
    },
    block() {
      return read((p) => p.getBlockNumber());
    },
    current(address) {
      return read(async (p, c) => {
        const at = { blockTag: await p.getBlockNumber() };
        const [name, balance] = await Promise.all([
          c.handleOf(address, at),
          c.balanceOf(address, at),
        ]);
        return name && balance > 0n ? name + ".ai" : null;
      });
    },
    previous(address, block) {
      return read(
        async (p, c) => (await c.balanceOf(address, { blockTag: block })) > 0n,
      );
    },
    owner(name) {
      return read(async (p, c) => {
        const addr = await c.ownerOfHandle(name.slice(0, -3));
        return addr === ZeroAddress ? null : getAddress(addr);
      });
    },
  };
}
