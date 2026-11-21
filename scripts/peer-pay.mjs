import { randomBytes } from "node:crypto";
import { getAddress, verifyMessage, Interface, parseUnits } from "ethers";
import {
  createCashClient,
  capabilitiesToJson,
  estimateToJson,
  orderToJson,
  prepareResultToJson,
  preparedTxToJson,
  cashoutResultToJson,
} from "@zkp2p/cash";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
export const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const erc = new Interface(["function approve(address spender,uint256 amount)"]);
export function paymentInput(input) {
  const raw = String(input.amount || "");
  if (!/^(0|[1-9]\d{0,5})(\.\d{1,6})?$/.test(raw))
    throw Error("INVALID_AMOUNT");
  const amount = parseUnits(raw, 6);
  if (amount < 10000n || amount > 100000000000n) throw Error("INVALID_AMOUNT");
  const platform = String(input.platform || "xmoney");
  if (!["xmoney", "cashapp", "venmo"].includes(platform))
    throw Error("UNSUPPORTED_PLATFORM");
  const payee = String(input.payee || "")
    .trim()
    .replace(/^[@$]/, "")
    .toLowerCase();
  const pattern =
    platform === "xmoney"
      ? /^[a-z0-9_]{1,15}$/
      : platform === "cashapp"
        ? /^(?=.*[a-z])[a-z0-9_-]{1,20}$/
        : /^[a-z0-9_-]{5,30}$/;
  if (!pattern.test(payee)) throw Error("INVALID_PAYEE");
  return { amount, receive: { platform, currency: "USD", payee } };
}
export function validatePlan(plan, amount) {
  if (
    plan.txs.length !== 2 ||
    plan.steps[0]?.kind !== "approve" ||
    plan.steps[1]?.kind !== "createDeposit"
  )
    throw Error("UNEXPECTED_PAYMENT_PLAN");
  const [approval, deposit] = plan.txs;
  for (const tx of plan.txs)
    if (
      tx.chainId !== 8453 ||
      BigInt(tx.value || 0) !== 0n ||
      !/^0x[\da-f]{40}$/i.test(tx.to) ||
      !/^0x[\da-f]+$/i.test(tx.data)
    )
      throw Error("UNEXPECTED_PAYMENT_PLAN");
  const decoded = erc.decodeFunctionData("approve", approval.data);
  if (
    getAddress(approval.to) !== USDC ||
    getAddress(decoded.spender) !== getAddress(deposit.to) ||
    decoded.amount !== amount
  )
    throw Error("UNEXPECTED_PAYMENT_PLAN");
  return plan;
}
export function createPeerService({
  identity,
  cash = createCashClient({ environment: "production" }),
  publicClient = createPublicClient({
    chain: base,
    transport: http("https://mainnet.base.org"),
  }),
  origin = "http://127.0.0.1:5206",
  now = () => Date.now(),
} = {}) {
  const challenges = new Map(),
    sessions = new Map();
  const fresh = () => {
    for (const map of [challenges, sessions])
      for (const [k, v] of map) if (v.expires < now()) map.delete(k);
    if (challenges.size > 500 || sessions.size > 500)
      throw Error("TOO_MANY_REQUESTS");
  };
  const actor = async (token, requireID = true) => {
    fresh();
    const a = sessions.get(token);
    if (!a) throw Error("AGENT_SESSION_REQUIRED");
    const id = requireID ? await identity(a.address) : { eligible: true };
    if (!id.eligible) throw Error("AGENT_ID_REQUIRED");
    return a.address;
  };
  return {
    capabilities: () => ({
      ...capabilitiesToJson(cash.capabilities()),
      sdk: "@zkp2p/cash@0.8.2",
      execution: "user-wallet-only",
      agentGate:
        "Dark application gate; Peer contracts do not check BSC Agent ID",
    }),
    estimate: async (input) => {
      const p = paymentInput({ ...input, payee: "dark_preview" });
      return {
        ...estimateToJson(
          await cash.estimate(
            { amount: p.amount, currency: "USD", platform: p.receive.platform },
            { includeEta: false },
          ),
        ),
        checkedAt: new Date(now()).toISOString(),
      };
    },
    challenge(address) {
      fresh();
      address = getAddress(address);
      const id = randomBytes(24).toString("hex"),
        expires = now() + 300000;
      const message = `Dark Agent payment access\nOrigin: ${origin}\nWallet: ${address}\nPurpose: verify Agent ID and prepare unsigned Base USDC payment plans. No spending permission.\nNonce: ${id}\nExpires: ${new Date(expires).toISOString()}`;
      challenges.set(id, { address, expires, message });
      return { id, message, expires };
    },
    async authenticate({ id, signature }) {
      fresh();
      const c = challenges.get(id);
      challenges.delete(id);
      if (!c || c.expires < now()) throw Error("CHALLENGE_EXPIRED");
      let recovered;
      try {
        recovered = getAddress(verifyMessage(c.message, signature));
      } catch {
        throw Error("INVALID_SIGNATURE");
      }
      if (recovered !== c.address) throw Error("INVALID_SIGNATURE");
      const state = await identity(c.address);
      const token = randomBytes(32).toString("hex"),
        expires = now() + 600000;
      sessions.set(token, { address: c.address, expires });
      return {
        token,
        address: c.address,
        expires,
        block: state.block,
        eligible: state.eligible,
      };
    },
    async prepare(input, token) {
      const owner = await actor(token),
        request = paymentInput(input);
      const plan = validatePlan(await cash.prepare(request), request.amount);
      const code = await publicClient.getCode({ address: plan.txs[1].to });
      if (!code || code === "0x") throw Error("ESCROW_NOT_DEPLOYED");
      return {
        ...prepareResultToJson(plan),
        owner,
        amount: request.amount.toString(),
        platform: request.receive.platform,
        currency: "USD",
        payee: request.receive.payee,
        expires: now() + 300000,
        chainId: 8453,
      };
    },
    async withdraw(id, token) {
      const owner = await actor(token, false);
      const own = await cash.orders(owner);
      if (!own.some((o) => o.depositId === id))
        throw Error("ORDER_OWNER_MISMATCH");
      const result = await cash.prepareWithdraw(id);
      return {
        owner,
        chainId: 8453,
        expires: now() + 300000,
        txs: result.txs.map(preparedTxToJson),
        steps: result.steps,
      };
    },
    async orders(owner) {
      getAddress(owner);
      return (await cash.orders(owner)).map(orderToJson);
    },
    async order(id) {
      if (typeof id !== "string" || id.length > 150)
        throw Error("INVALID_DEPOSIT_ID");
      const order = await cash.order(id);
      return { ...orderToJson(order), explanation: order.explain() };
    },
    async receipt(hash) {
      if (!/^0x[\da-f]{64}$/i.test(hash)) throw Error("INVALID_HASH");
      const receipt = await publicClient.getTransactionReceipt({ hash });
      return cashoutResultToJson(cash.finalizePreparedCashout(receipt));
    },
  };
}
