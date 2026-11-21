import {
  BrowserProvider,
  JsonRpcProvider,
  FetchRequest,
  getAddress,
  parseEther,
  Contract,
  Transaction,
} from "ethers";
export type PeerTx = {
  to: string;
  data: string;
  value: string;
  chainId: number;
};
export type PeerPlan = {
  owner: string;
  chainId: number;
  expires: number;
  amount?: string;
  payee?: string;
  platform?: string;
  txs: PeerTx[];
  steps: { kind: string; description: string }[];
};
export type PendingPay = {
  owner: string;
  txs: PeerTx[];
  steps: PeerPlan["steps"];
  index: number;
  attempted: boolean;
  hash: string;
  nonce?: number;
  fees: string;
  maxFee: string;
  at: number;
  kind: "payment" | "withdraw";
  depositId?: string;
};
const ORACLE = "0x420000000000000000000000000000000000000F";
const ORACLE_ABI = [
  "function getL1Fee(bytes) view returns(uint256)",
  "function getOperatorFee(uint256) view returns(uint256)",
];
const KEY = "dark:peer:pending";
export function pendingPay(): PendingPay | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "null");
  } catch {
    return null;
  }
}
export function savePending(p: PendingPay | null) {
  if (p) localStorage.setItem(KEY, JSON.stringify(p));
  else localStorage.removeItem(KEY);
}
export function baseReader() {
  const req = new FetchRequest(location.origin + "/api/rpc/base");
  req.timeout = 20000;
  return new JsonRpcProvider(req, 8453, {
    staticNetwork: true,
    batchMaxCount: 10,
  });
}
async function currentWallet(owner: string) {
  if (!window.ethereum) throw Error("WALLET_NOT_FOUND");
  const provider = new BrowserProvider(window.ethereum);
  const accounts = await provider.send("eth_accounts", []);
  if (!accounts[0] || getAddress(accounts[0]) !== getAddress(owner))
    throw Error("WALLET_CHANGED");
  if (Number(await provider.send("eth_chainId", [])) !== 8453)
    throw Error("SWITCH_TO_BASE");
  return provider.getSigner(owner);
}
function reject(e: any) {
  return (
    e?.code === 4001 ||
    e?.code === "ACTION_REJECTED" ||
    e?.info?.error?.code === 4001
  );
}
export async function resumePayment(
  p: PendingPay,
  update: (p: PendingPay) => void,
  dependencies: {
    read?: ReturnType<typeof baseReader>;
    wallet?: typeof currentWallet;
  } = {},
) {
  if (p.attempted) throw Error("RECONCILE_FIRST");
  const read = dependencies.read || baseReader();
  const oracle = new Contract(ORACLE, ORACLE_ABI, read);
  if (
    !/^0\.\d{1,9}$/.test(p.maxFee) ||
    Number(p.maxFee) <= 0 ||
    Number(p.maxFee) > 0.1
  )
    throw Error("INVALID_GAS_BUDGET");
  while (p.index < p.txs.length) {
    const tx = p.txs[p.index];
    if (tx.chainId !== 8453 || BigInt(tx.value || 0) !== 0n)
      throw Error("INVALID_PAYMENT_PLAN");
    const signer = await (dependencies.wallet || currentWallet)(p.owner);
    const gas =
      ((await read.estimateGas({
        from: p.owner,
        to: tx.to,
        data: tx.data,
        value: 0,
      })) *
        120n) /
      100n;
    const fee = await read.getFeeData();
    const maxFee = fee.maxFeePerGas ?? fee.gasPrice;
    if (!maxFee) throw Error("GAS_UNAVAILABLE");
    p.nonce = await read.getTransactionCount(p.owner, "pending");
    const serialized = Transaction.from({
      type: 2,
      chainId: 8453,
      to: tx.to,
      data: tx.data,
      value: 0n,
      nonce: p.nonce,
      gasLimit: gas,
      maxFeePerGas: maxFee,
      maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? 0n,
    }).unsignedSerialized;
    const [l1, operator] = await Promise.all([
      oracle.getL1Fee(serialized),
      oracle.getOperatorFee(gas),
    ]);
    const estimate = gas * maxFee + l1 * 3n + operator * 2n;
    if (BigInt(p.fees) + estimate > parseEther(p.maxFee))
      throw Error("GAS_BUDGET_EXCEEDED");
    const balance = await read.getBalance(p.owner);
    if (balance < estimate) throw Error("BASE_GAS_REQUIRED");
    p.attempted = true;
    p.hash = "";
    savePending(p);
    update({ ...p });
    let sent;
    try {
      sent = await signer.sendTransaction({
        to: tx.to,
        data: tx.data,
        value: 0,
        chainId: 8453,
        nonce: p.nonce,
        gasLimit: gas,
        ...(fee.maxFeePerGas
          ? {
              maxFeePerGas: maxFee,
              maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? 0n,
            }
          : { gasPrice: maxFee }),
      });
    } catch (e) {
      if (reject(e)) {
        p.attempted = false;
        savePending(p);
        update({ ...p });
        throw Error("WALLET_REJECTED");
      }
      throw Error("SUBMISSION_UNKNOWN");
    }
    p.hash = sent.hash;
    savePending(p);
    update({ ...p });
    const receipt = await read.waitForTransaction(sent.hash, 2, 120000);
    if (!receipt) throw Error("RECEIPT_PENDING");
    p.fees = (BigInt(p.fees) + (await receiptCost(read, receipt))).toString();
    if (receipt.status !== 1) {
      p.attempted = false;
      p.hash = "";
      savePending(p);
      update({ ...p });
      throw Error("TRANSACTION_REVERTED");
    }
    p.index++;
    p.attempted = false;
    savePending(p);
    update({ ...p });
  }
  return p;
}
async function receiptCost(read: ReturnType<typeof baseReader>, receipt: any) {
  const raw = await read.send("eth_getTransactionReceipt", [receipt.hash]);
  if (raw?.l1Fee == null) throw Error("FEE_RECEIPT_UNAVAILABLE");
  const oracle = new Contract(ORACLE, ORACLE_ABI, read);
  const operator = await oracle.getOperatorFee(receipt.gasUsed, {
    blockTag: receipt.blockNumber,
  });
  return (
    BigInt(receipt.gasUsed) * BigInt(receipt.gasPrice) +
    BigInt(raw.l1Fee) +
    BigInt(operator)
  );
}
export async function reconcilePayment(
  p: PendingPay,
  hash: string,
  reader?: ReturnType<typeof baseReader>,
) {
  if (!p.attempted || p.index >= p.txs.length) throw Error("RECONCILE_FIRST");
  if (!/^0x[\da-f]{64}$/i.test(hash)) throw Error("INVALID_HASH");
  const read = reader || baseReader();
  const tx = await read.getTransaction(hash),
    receipt = await read.getTransactionReceipt(hash);
  const expected = p.txs[p.index];
  if (!tx || !receipt) throw Error("RECEIPT_PENDING");
  if (
    getAddress(tx.from) !== getAddress(p.owner) ||
    !tx.to ||
    getAddress(tx.to) !== getAddress(expected.to) ||
    tx.data.toLowerCase() !== expected.data.toLowerCase() ||
    tx.value !== 0n ||
    tx.chainId !== 8453n ||
    tx.nonce !== p.nonce
  )
    throw Error("RECEIPT_MISMATCH");
  if ((await receipt.confirmations()) < 2) throw Error("RECEIPT_PENDING");
  p.fees = (BigInt(p.fees) + (await receiptCost(read, receipt))).toString();
  p.hash = hash;
  p.attempted = false;
  if (receipt.status === 1) p.index++;
  else p.hash = "";
  savePending(p);
  return p;
}
