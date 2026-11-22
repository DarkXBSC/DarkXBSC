// Only the background worker owns the funding signer. All journaled transfers pay
// native gas to an address derived from a local collection route.
import {
  Contract,
  Transaction,
  Wallet,
  getAddress,
  keccak256,
  parseEther,
  toQuantity,
} from "ethers";

const oracleAddress = "0x420000000000000000000000000000000000000F";
const oracleAbi = [
  "function getL1Fee(bytes) view returns(uint256)",
  "function getOperatorFee(uint256) view returns(uint256)",
];

async function transactionFees(provider, chainId) {
  const fee = await provider.getFeeData();
  if (chainId === 8453 && fee.maxFeePerGas > 0n)
    return {
      type: 2,
      maxFeePerGas: fee.maxFeePerGas,
      maxPriorityFeePerGas: fee.maxPriorityFeePerGas || 0n,
    };
  if (fee.gasPrice > 0n) return { type: 0, gasPrice: fee.gasPrice };
  throw Error("X_GAS_UNAVAILABLE");
}

export async function prepareRouteGas(provider, chainId, address, tx) {
  if ((await provider.getNetwork()).chainId !== BigInt(chainId))
    throw Error("X_CHAIN_MISMATCH");
  const call = {
    from: address,
    to: tx.to,
    data: tx.data,
    value: toQuantity(tx.value ?? 0n),
  };
  let units;
  try {
    units = await provider.estimateGas({ ...call, gasPrice: 0n });
  } catch {
    // A balance override lets an unfunded sender simulate the same call. Token
    // balances, allowance, code and every other account keep their real state.
    units = BigInt(
      await provider.send("eth_estimateGas", [
        call,
        "latest",
        {
          [address]: {
            balance: toQuantity(BigInt(tx.value ?? 0n) + parseEther("1")),
          },
        },
      ]),
    );
  }
  return {
    ...tx,
    chainId: BigInt(chainId),
    nonce: await provider.getTransactionCount(address, "pending"),
    gasLimit: (units * 120n + 99n) / 100n,
    ...(await transactionFees(provider, chainId)),
  };
}

async function cost(provider, tx) {
  const execution = tx.gasLimit * (tx.maxFeePerGas ?? tx.gasPrice);
  if (BigInt(tx.chainId) !== 8453n) return execution;
  const oracle = new Contract(oracleAddress, oracleAbi, provider);
  const [data, operator] = await Promise.all([
    oracle.getL1Fee(Transaction.from(tx).unsignedSerialized),
    oracle.getOperatorFee(tx.gasLimit),
  ]);
  return execution + 3n * data + 2n * operator;
}

export function createGasSponsor({
  db,
  key,
  providers,
  routeAddress,
  limits,
  reservedNative = () => 0n,
  authorizedNative = () => false,
}) {
  const signer = new Wallet(key);
  db.exec(`CREATE TABLE IF NOT EXISTS gasTransfers(
    chain INTEGER NOT NULL, sponsor TEXT NOT NULL, nonce INTEGER NOT NULL,
    route INTEGER NOT NULL, raw TEXT NOT NULL, state TEXT NOT NULL,
    PRIMARY KEY(chain,sponsor,nonce));
    CREATE UNIQUE INDEX IF NOT EXISTS gasInFlight ON gasTransfers(chain,sponsor) WHERE state='pending';`);
  const pending = (chain) =>
    db
      .prepare(
        "SELECT * FROM gasTransfers WHERE chain=? AND sponsor=? AND state='pending'",
      )
      .get(chain, signer.address);
  const update = (chain, nonce, state) =>
    db
      .prepare(
        "UPDATE gasTransfers SET state=? WHERE chain=? AND sponsor=? AND nonce=? AND state='pending'",
      )
      .run(state, chain, signer.address, nonce);
  async function resume(chain, idx) {
    const row = pending(chain);
    if (!row || (idx !== undefined && row.route !== idx)) return;
    const p = providers[chain],
      tx = Transaction.from(row.raw),
      hash = keccak256(row.raw);
    if (
      tx.chainId !== BigInt(chain) ||
      tx.from !== signer.address ||
      tx.to !== routeAddress(row.route) ||
      tx.nonce !== row.nonce ||
      tx.data !== "0x" ||
      tx.value <= 0n ||
      tx.gasLimit !== 21000n
    )
      throw Error("X_GAS_REVIEW");
    const receipt = await p.getTransactionReceipt(hash);
    if (receipt) {
      if (receipt.blockNumber > (await p.getBlock("finalized")).number)
        throw Error("X_GAS_FUNDING");
      if (
        receipt.status !== 1 ||
        getAddress(receipt.from) !== signer.address ||
        getAddress(receipt.to) !== tx.to
      )
        throw Error("X_GAS_REVIEW");
      update(chain, tx.nonce, "confirmed");
      return;
    }
    if (await p.getTransaction(hash)) throw Error("X_GAS_FUNDING");
    if ((await p.getTransactionCount(signer.address, "finalized")) > tx.nonce)
      throw Error("X_GAS_REVIEW");
    // Authorization is already journaled. Recovery can only replay those bytes.
    const nonce = await p.getTransactionCount(signer.address, "pending");
    if (nonce === tx.nonce) await p.broadcastTransaction(row.raw);
    throw Error("X_GAS_FUNDING");
  }
  async function ensure(chain, idx, raw) {
    const p = providers[chain],
      address = routeAddress(idx),
      routeTx = Transaction.from(raw);
    if (
      !p ||
      routeTx.from !== address ||
      routeTx.chainId !== BigInt(chain) ||
      (routeTx.value !== 0n && !authorizedNative(idx, raw, chain))
    )
      throw Error("X_GAS_REVIEW");
    await resume(chain, idx);
    const version = db
      .prepare(
        "SELECT IFNULL(MAX(rowid),0) AS n FROM gasTransfers WHERE chain=? AND sponsor=?",
      )
      .get(chain, signer.address).n;
    const needed = await cost(p, routeTx);
    if (needed <= 0n || needed > limits[chain]) throw Error("X_GAS_PRICE_HIGH");
    const reserved = reservedNative(idx, chain);
    const totalBalance = await p.getBalance(address);
    if (totalBalance < reserved || routeTx.value > reserved)
      throw Error("X_CONVERSION_REVIEW");
    const balance = totalBalance - reserved;
    if (balance >= needed) return;
    if (pending(chain)) throw Error("X_GAS_FUNDING");
    if ((await p.getCode(address)) !== "0x") throw Error("X_GAS_REVIEW");
    // Small headroom avoids repeated tiny transfers when fee quotes fluctuate.
    // Accumulated route balance is reused on the next step and batch.
    const value = needed + needed / 10n - balance;
    const [nonce, latest, fees] = await Promise.all([
      p.getTransactionCount(signer.address, "pending"),
      p.getTransactionCount(signer.address, "latest"),
      transactionFees(p, chain),
    ]);
    if (nonce !== latest) throw Error("X_GAS_FUNDING");
    const tx = {
      chainId: BigInt(chain),
      to: address,
      value,
      gasLimit: 21000n,
      nonce,
      ...fees,
    };
    const total = value + (await cost(p, tx));
    if (total > limits[chain]) throw Error("X_GAS_PRICE_HIGH");
    if ((await p.getBalance(signer.address, "pending")) < total)
      throw Error("X_GAS_SPONSOR_LOW");
    const signed = await signer.signTransaction(tx);
    // The unique active nonce per network serializes workers and routes.
    const saved = db
      .prepare(
        "INSERT OR IGNORE INTO gasTransfers(chain,sponsor,nonce,route,raw,state) SELECT ?,?,?,?,?,'pending' WHERE NOT EXISTS (SELECT 1 FROM gasTransfers WHERE chain=? AND sponsor=? AND rowid>?)",
      )
      .run(
        chain,
        signer.address,
        nonce,
        idx,
        signed,
        chain,
        signer.address,
        version,
      );
    if (saved.changes) await resume(chain, idx);
    throw Error("X_GAS_FUNDING");
  }
  return { ensure, resume };
}
