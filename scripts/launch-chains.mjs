import { readFileSync } from "node:fs";
import { getAddress, getCreate2Address, keccak256 } from "ethers";

const protocols = JSON.parse(readFileSync(new URL("../public/protocols.json", import.meta.url)));
export const launchChains = {
  56: {
    key: "bsc", id: 56, symbol: "BNB", stableSymbol: "USDT", decimals: 18,
    stable: getAddress("0x55d398326f99059ff775485246999027b3197955"),
    wrapped: getAddress("0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c"),
    router: getAddress("0x10ed43c718714eb63d5aa57b78b54704e256024e"),
    factory: getAddress("0xca143ce32fe78f1f7019d7d551a6402fc5350c73"),
    intermediates: [getAddress("0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d")],
    nativeUsdFeed: getAddress("0x0567f2323251f0aab15c8dfb1967e4e8a7d42aee"),
    stableUsdFeed: getAddress("0xb97ad0e74fa7d920791e90258a6e2085088b4320"),
    ...protocols.flap,
  },
  8453: {
    key: "base", id: 8453, symbol: "ETH", stableSymbol: "USDC", decimals: 6,
    stable: getAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"),
    wrapped: getAddress("0x4200000000000000000000000000000000000006"),
    router: getAddress("0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24"),
    factory: getAddress("0x8909dc15e40173ff4699343b6eb8132c65e18ec6"),
    intermediates: [],
    nativeUsdFeed: getAddress("0x71041dddad3595f9ced3dccfbe3d1f4b0a16bb70"),
    stableUsdFeed: getAddress("0x7e860098f58bbfc8648a4311b374b1d669a2bc6b"),
    sequencer: getAddress("0xbcf85224fc0756b9fa45aa7892530b47e10b6433"),
    ...protocols.flapChains.base,
  },
};
export function launchChain(id = 56) {
  if (![56, 8453].includes(Number(id))) throw Error("UNSUPPORTED_LAUNCH_CHAIN");
  return launchChains[Number(id)];
}
export function taxClone(id = 56) {
  return "0x363d3d373d3d3d363d73" + launchChain(id).taxImplementation.slice(2).toLowerCase() + "5af43d82803e903d91602b57fd5bf3";
}
export function predictTaxToken(salt, id = 56) {
  const hash = keccak256("0x3d602d80600a3d3981f3" + taxClone(id).slice(2));
  return getCreate2Address(launchChain(id).portal, salt, hash);
}

// Preserve every existing route index (and its HD address), ciphertext and batch.
// One ledger also keeps the gas sponsor's nonce journal shared across both chains.
export function migrateRouteChains(db) {
  const migrated = () => db.prepare("SELECT sql FROM sqlite_master WHERE name='routes'").get()?.sql.includes("4663");
  if (migrated()) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!migrated()) {
      const chain = db.prepare("PRAGMA table_info(routes)").all().some(c => c.name === "chain") ? "chain" : "56";
      db.exec(`CREATE TABLE routes_multi(idx INTEGER PRIMARY KEY,chain INTEGER NOT NULL DEFAULT 56 CHECK(chain IN (56,8453,4663)),token TEXT NOT NULL,address TEXT UNIQUE,identity TEXT,ticket TEXT,lastBlock INTEGER,received TEXT DEFAULT '0',issue TEXT DEFAULT '',UNIQUE(chain,token));
        INSERT INTO routes_multi(idx,chain,token,address,identity,ticket,lastBlock,received,issue) SELECT idx,${chain},token,address,identity,ticket,lastBlock,received,issue FROM routes;
        DROP TABLE routes;
        ALTER TABLE routes_multi RENAME TO routes;`);
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}
