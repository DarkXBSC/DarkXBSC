import { takeGivingHandoff } from "../lib/giving-handoff";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BrowserProvider, formatUnits } from "ethers";
import {
  ArrowRight,
  Check,
  ShieldCheck,
  RefreshCw,
  Send,
  Wallet,
  LockKeyhole,
} from "lucide-react";
import { useApp } from "../lib/context";
import { CopyText } from "../components/Frame";
import {
  pendingPay,
  savePending,
  resumePayment,
  reconcilePayment,
  type PeerPlan,
  type PendingPay,
} from "../lib/peer-wallet";
const api = async (path: string, input?: unknown, token = "") => {
  const r = await fetch("/api/peer/" + path, {
    method: input ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    ...(input ? { body: JSON.stringify(input) } : {}),
  });
  const d = await r.json();
  if (!r.ok) throw Error(d.error || "PEER_UNAVAILABLE");
  return d;
};
const errors: Record<string, [string, string]> = {
  PLAN_EXPIRED: [
    "The plan expired. Prepare a fresh plan before signing.",
    "计划已过期，请重新准备后签名。",
  ],
  INVALID_GAS_BUDGET: [
    "Enter a fee budget greater than zero and no more than 0.1 ETH, up to nine decimals.",
    "网络费预算须大于零、不超过 0.1 ETH，最多九位小数。",
  ],
  TRANSACTION_REVERTED: [
    "The transaction reverted. Gas was spent; no payment step advanced. Review before retrying.",
    "交易已回滚，已计入 Gas，但付款步骤未推进。请核对后再重试。",
  ],
  FEE_RECEIPT_UNAVAILABLE: [
    "The fee receipt could not be read. Keep the transaction hash and reconcile it before continuing.",
    "暂时无法读取费用回执，请保留哈希并核对后继续。",
  ],
  INVALID_HASH: [
    "Enter the full transaction hash from your wallet history.",
    "请输入钱包记录中的完整交易哈希。",
  ],

  AGENT_ID_REQUIRED: [
    "This wallet has no Binance Agent ID. Existing funds remain withdrawable.",
    "当前钱包未持有 Binance Agent ID；已有订单仍可提现。",
  ],
  SWITCH_TO_BASE: [
    "Switch your wallet to Base to continue.",
    "请将钱包切换到 Base 后继续。",
  ],
  INVALID_AMOUNT: [
    "Enter 0.01–100,000 USDC, with at most 6 decimals.",
    "请输入 0.01–100,000 USDC，最多六位小数。",
  ],
  INVALID_PAYEE: [
    "Check the recipient handle for this payment method.",
    "请检查对应渠道的收款账号格式。",
  ],
  WALLET_CHANGED: [
    "The wallet changed. Reconnect the original account.",
    "钱包已切换，请重新连接原账户。",
  ],
  RECONCILE_FIRST: [
    "A submission is unresolved. Check its hash before sending again.",
    "上一笔提交状态未知，请先核对哈希，不能重复发送。",
  ],
  GAS_BUDGET_EXCEEDED: [
    "Estimated gas exceeds your fee limit. Adjust the limit before retrying.",
    "预估 Gas 超出你设置的上限，请调整上限后重试。",
  ],
  BASE_GAS_REQUIRED: [
    "This wallet needs ETH on Base for transaction fees.",
    "当前钱包需要 Base ETH 支付网络费。",
  ],
  SUBMISSION_UNKNOWN: [
    "The wallet may have submitted this transaction. Reconcile the hash; do not resend.",
    "钱包可能已提交交易，请核对交易哈希，不要重复发送。",
  ],
  WALLET_REJECTED: [
    "Wallet request cancelled. No new transaction was submitted.",
    "已取消钱包请求，未提交新的交易。",
  ],
  AGENT_SESSION_REQUIRED: [
    "Verify your wallet again; its access session has expired.",
    "访问会话已过期，请重新验证钱包。",
  ],
  PEER_UNAVAILABLE: [
    "Peer is temporarily unavailable. Retry this read; keep any pending payment.",
    "Peer 暂不可用。请重试读取并保留待核对付款。",
  ],
  RECEIPT_PENDING: [
    "The transaction is not confirmed yet. Keep the hash and check again.",
    "交易尚未确认，请保留哈希并稍后核对。",
  ],
  RECEIPT_MISMATCH: [
    "This hash does not match the saved request. Check your wallet history.",
    "哈希与保存的请求不一致，请核对钱包记录。",
  ],
};
export default function XPay() {
  const { t, account, connect } = useApp();
  const [prefill] = useState(takeGivingHandoff);
  const [platform, setPlatform] = useState("xmoney"),
    [payee, setPayee] = useState(prefill?.payee || ""),
    [amount, setAmount] = useState(prefill?.amount || "10"),
    [maxFee, setMaxFee] = useState("0.001"),
    [consent, setConsent] = useState(false),
    [estimate, setEstimate] = useState<any>(null),
    [caps, setCaps] = useState<any>(null),
    [session, setSession] = useState<any>(null),
    [plan, setPlan] = useState<PeerPlan | null>(null),
    [pending, setPending] = useState<PendingPay | null>(pendingPay),
    [orders, setOrders] = useState<any[]>([]),
    [order, setOrder] = useState<any>(null),
    [orderId, setOrderId] = useState(""),
    [recoveryHash, setRecoveryHash] = useState(""),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [tab, setTab] = useState("send");
  const lock = useRef(false),
    generation = useRef(0);
  useEffect(() => {
    api("capabilities")
      .then(setCaps)
      .catch(() => setError("PEER_UNAVAILABLE"));
  }, []);
  useEffect(() => {
    setSession(null);
    setPlan(null);
    setOrders([]);
    if (account)
      api("orders?owner=" + account)
        .then(setOrders)
        .catch(() => {});
  }, [account]);
  useEffect(() => {
    generation.current++;
    setPlan(null);
    setEstimate(null);
    setConsent(false);
  }, [platform, payee, amount]);
  async function action(name: string, fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(name);
    setError("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message || "PEER_UNAVAILABLE");
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  async function authenticate() {
    if (!account) {
      await connect();
      return;
    }
    const provider = new BrowserProvider(window.ethereum);
    const challenge = await api("challenge", { address: account });
    const signature = await (
      await provider.getSigner(account)
    ).signMessage(challenge.message);
    const auth = await api("authenticate", { id: challenge.id, signature });
    setSession(auth);
    if (!auth.eligible) setError("AGENT_ID_REQUIRED");
  }
  async function quote() {
    const g = generation.current;
    const result = await api("estimate", { amount, platform });
    if (g === generation.current) setEstimate(result);
  }
  async function prepare() {
    if (!consent) throw Error("RECIPIENT_CONFIRMATION_REQUIRED");
    const g = generation.current;
    const p = await api("prepare", { amount, platform, payee }, session?.token);
    if (g === generation.current) setPlan(p);
  }
  async function finalize(p: PendingPay) {
    if (p.index < p.txs.length) return;
    let id = p.depositId;
    if (p.kind === "payment") {
      const result = await api("receipt?hash=" + p.hash);
      id = result.depositId;
      setOrderId(id || "");
    }
    savePending(null);
    setPending(null);
    setPlan(null);
    if (id) {
      setOrderId(id);
      setTab("orders");
      try {
        setOrder(await api("order?id=" + encodeURIComponent(id)));
      } catch {
        setError("RECEIPT_PENDING");
      }
    }
    if (account)
      try {
        setOrders(await api("orders?owner=" + account));
      } catch {}
  }
  async function send() {
    if (!plan || plan.expires < Date.now()) throw Error("PLAN_EXPIRED");
    if (pendingPay()) throw Error("RECONCILE_FIRST");
    if (
      !/^0\.\d{1,9}$/.test(maxFee) ||
      Number(maxFee) <= 0 ||
      Number(maxFee) > 0.1
    )
      throw Error("INVALID_GAS_BUDGET");
    const p: PendingPay = {
      owner: plan.owner,
      txs: plan.txs,
      steps: plan.steps,
      index: 0,
      attempted: false,
      hash: "",
      fees: "0",
      maxFee,
      at: Date.now(),
      kind: "payment",
    };
    savePending(p);
    setPending(p);
    const done = await resumePayment(p, setPending);
    await finalize(done);
  }
  async function checkOrder(id = orderId) {
    setOrder(await api("order?id=" + encodeURIComponent(id)));
    setOrderId(id);
  }
  async function withdraw() {
    if (!order) return;
    const p = await api(
      "withdraw",
      { depositId: order.depositId },
      session?.token,
    );
    if (pendingPay()) throw Error("RECONCILE_FIRST");
    const record: PendingPay = {
      owner: p.owner,
      txs: p.txs,
      steps: p.steps,
      index: 0,
      attempted: false,
      hash: "",
      fees: "0",
      maxFee,
      at: Date.now(),
      kind: "withdraw",
      depositId: order.depositId,
    };
    savePending(record);
    setPending(record);
    await finalize(await resumePayment(record, setPending));
  }
  const e = errors[error];
  const status = (s: string) =>
    t(
      (
        {
          "awaiting-buyer": "Waiting for a buyer",
          matched: "Buyer matched",
          delivering: "USDC partially released",
          delivered: "Escrow completed · inspect proof",
          returned: "Funds returned",
        } as any
      )[s] || s,
      (
        {
          "awaiting-buyer": "等待买家",
          matched: "买家已匹配",
          delivering: "USDC 部分已释放",
          delivered: "金库处理完成 · 请核对付款证明",
          returned: "资金已退回",
        } as any
      )[s] || s,
    );
  return (
    <>
      <div className="desk-page-heading">
        <div>
          <h1>{t("Pay people on X", "向 X 用户付款")}</h1>
          <p>
            {t(
              "Base USDC in. X Money to the recipient. Powered by Peer.",
              "使用 Base USDC，由 Peer 买家向收款人的 X Money 付款。",
            )}
          </p>
        </div>
        <span className="pill-status">
          Peer Cash ·{" "}
          {caps ? t("Mainnet route", "主网路径") : t("Connecting", "连接中")}
        </span>
      </div>
      <div className="inline-tabs">
        <button
          className={tab === "send" ? "selected" : ""}
          onClick={() => setTab("send")}
        >
          {t("New payment", "新建付款")}
        </button>
        <button
          className={tab === "orders" ? "selected" : ""}
          onClick={() => setTab("orders")}
        >
          {t("Track & recover", "查询与恢复")}
        </button>
        <Link to="/app/impact">{t("Private giving", "隐私公益")}</Link>
        <Link to="/app/agent-pay">
          {t("Bridge & treasury", "跨链与资金计划")}
        </Link>
      </div>
      {pending && (
        <div className="state-callout">
          <b>
            {t("Saved payment operation", "已保存的付款操作")} · {pending.index}
            /{pending.txs.length}
          </b>
          <p>
            {t(
              "Resolve this operation before starting another. No recipient handle is saved in this browser record.",
              "请先处理这笔操作。浏览器恢复记录不保存收款人的社交账号。",
            )}
          </p>
          {pending.owner !== account ? (
            <p>
              {t("Connect the original wallet: ", "请连接原钱包：")}
              {pending.owner}
            </p>
          ) : (
            <div className="row-actions">
              {pending.attempted ? (
                <>
                  <input
                    aria-label={t(
                      "Transaction hash to reconcile",
                      "核对交易哈希",
                    )}
                    value={recoveryHash || pending.hash}
                    onChange={(e) => setRecoveryHash(e.target.value)}
                    placeholder="0x…"
                  />
                  <button
                    className="button"
                    disabled={!!busy}
                    onClick={() =>
                      void action("reconcile", async () => {
                        const p = await reconcilePayment(
                          { ...pending },
                          recoveryHash || pending.hash,
                        );
                        setPending(p);
                        await finalize(p);
                      })
                    }
                  >
                    {t("Check transaction", "核对交易")}
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="button"
                    disabled={!!busy}
                    onClick={() =>
                      void action(
                        "resume",
                        async () =>
                          await finalize(
                            await resumePayment({ ...pending }, setPending),
                          ),
                      )
                    }
                  >
                    {pending.index === pending.txs.length
                      ? t("Recover order ID", "恢复订单编号")
                      : t("Continue saved operation", "继续已保存操作")}
                  </button>
                  {pending.index < pending.txs.length && (
                    <button
                      className="button"
                      disabled={!!busy}
                      onClick={() => {
                        savePending(null);
                        setPending(null);
                        setPlan(null);
                      }}
                    >
                      {t("Discard unsigned remainder", "放弃未签名的剩余步骤")}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
      {error && (
        <div className="state-callout" role="alert">
          {e ? t(...e) : error}
          <small> {error}</small>
        </div>
      )}
      {tab === "send" ? (
        <div className="desk-form-grid">
          <section className="desk-box">
            <div className="operation-heading">
              <h2>{t("Payment details", "付款信息")}</h2>
              <span className="network-chip">Base · USDC</span>
            </div>
            <div className="inline-tabs">
              {[
                ["xmoney", "X Money"],
                ["cashapp", "Cash App"],
                ["venmo", "Venmo"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  className={platform === id ? "selected" : ""}
                  onClick={() => setPlatform(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label>
              {t("Recipient account", "收款账号")}
              <input
                value={payee}
                onChange={(e) => setPayee(e.target.value)}
                placeholder={platform === "cashapp" ? "$cashtag" : "@username"}
                autoComplete="off"
              />
            </label>
            <label>
              {t("Amount · Base USDC", "付款金额 · Base USDC")}
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
              />
            </label>
            <label>
              {t(
                "Estimated network fee budget · ETH",
                "累计网络费估算预算 · ETH",
              )}
              <input
                value={maxFee}
                onChange={(e) => setMaxFee(e.target.value)}
                inputMode="decimal"
              />
              <small>
                {t(
                  "Checks L2 execution plus buffered L1 and operator fees before each step. L1 fees can change; confirm the final cost in your wallet.",
                  "每步检查 L2 执行费及含余量的 L1、运营费；L1 费用会变化，最终费用请在钱包核对。",
                )}
              </small>
            </label>
            <div className="row-actions">
              <button
                className="button"
                onClick={() => void action("estimate", quote)}
                disabled={!!busy}
              >
                {busy === "estimate"
                  ? t("Reading…", "读取中…")
                  : t("Get live estimate", "读取实时估算")}
              </button>
              <button
                className="button"
                onClick={() => void action("verify", authenticate)}
                disabled={!!busy}
              >
                <ShieldCheck size={15} />
                {session?.eligible
                  ? t("Agent ID verified", "Agent ID 已核验")
                  : t("Verify Agent ID", "核验 Agent ID")}
              </button>
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>
                {t(
                  "I have confirmed the recipient and their ability to receive this payment. Preparing shares this handle with Peer; the recipient and payment providers may see the payment.",
                  "我已确认收款账号及其收款能力。准备订单会把该账号发送给 Peer；收款人和支付服务商可能看到付款资料。",
                )}
                {platform === "xmoney" &&
                  t(
                    " X Money must already be enabled.",
                    " X Money 必须已开通。",
                  )}
              </span>
            </label>
            <button
              className="button primary full-width"
              disabled={!!busy || !session?.eligible || !consent || !!pending}
              onClick={() => void action("prepare", prepare)}
            >
              {busy === "prepare"
                ? t("Preparing…", "准备中…")
                : t("Prepare payment for review", "准备付款并检查")}
              <ArrowRight size={16} />
            </button>
            <p className="help">
              {t(
                "This step creates an unsigned plan. Your wallet signs the exact USDC approval and escrow deposit separately.",
                "这一步只生成未签名计划。你的钱包分别确认精确 USDC 授权与金库入金。",
              )}
            </p>
            {plan && (
              <div className="state-callout">
                <b>{t("Review before signing", "签名前核对")}</b>
                <dl className="financial-summary">
                  <div>
                    <dt>{t("Recipient", "收款人")}</dt>
                    <dd>@{plan.payee}</dd>
                  </div>
                  <div>
                    <dt>{t("USDC to lock", "锁入 USDC")}</dt>
                    <dd>{formatUnits(plan.amount || "0", 6)}</dd>
                  </div>
                  <div>
                    <dt>{t("Network", "网络")}</dt>
                    <dd>Base / 8453</dd>
                  </div>
                </dl>
                {plan.txs.map((tx, i) => (
                  <details key={i}>
                    <summary>
                      {i + 1}. {plan.steps[i].kind}
                    </summary>
                    <CopyText value={tx.to} />
                    <code className="address-line">{tx.data}</code>
                  </details>
                ))}
                <button
                  className="button primary full-width"
                  disabled={!!busy || !!pending}
                  onClick={() => void action("submit", send)}
                >
                  <Wallet size={16} />
                  {t("Confirm in my wallet", "在我的钱包确认")}
                </button>
              </div>
            )}
          </section>
          <aside className="desk-box">
            <h2>{t("Delivery estimate", "到账估算")}</h2>
            <p className="help">
              {t(
                "New integration: its first real payment has not yet been verified.",
                "新接入路径：尚未完成首笔真实付款验证。",
              )}
            </p>
            <div className="payout-amount">
              {estimate ? "$" + Number(estimate.receiveAmount).toFixed(2) : "—"}{" "}
              <small>USD</small>
            </div>
            <p className="help">
              {estimate
                ? t(
                    "Live oracle estimate. The rate is fixed when a buyer matches; this is not a payment receipt.",
                    "实时预言机估算，买家匹配时锁定汇率；此处不是付款回执。",
                  )
                : t(
                    "Read an estimate to see the current fiat value.",
                    "读取估算后显示当前法币价值。",
                  )}
            </p>
            <ol className="route-steps">
              {[
                [
                  t("Prepare", "准备"),
                  t(
                    "Verify the handle and review unsigned transactions.",
                    "确认账号，检查未签名交易。",
                  ),
                ],
                [
                  t("Deposit", "入金"),
                  t(
                    "Your wallet locks Base USDC in Peer escrow.",
                    "你的钱包把 Base USDC 锁入 Peer 金库。",
                  ),
                ],
                [
                  t("Buyer pays", "买家付款"),
                  t(
                    "A buyer sends cash to the recipient. Timing depends on buyers.",
                    "买家向收款人付款，等待时间取决于买方。",
                  ),
                ],
                [
                  t("Verify receipt", "验证回执"),
                  t(
                    "Only verified fiatPaid and paymentId count as delivered.",
                    "仅以验证后的实际付款金额与支付编号记为已付款。",
                  ),
                ],
              ].map(([a, b], i) => (
                <li key={a}>
                  <i>{i + 1}</i>
                  <div>
                    <b>{a}</b>
                    <p>{b}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="state-callout">
              <LockKeyhole size={16} />{" "}
              {t(
                "The handle stays offchain, but Peer and the payer know who to pay. This is not anonymous settlement.",
                "账号不直接写入链上，但 Peer 与付款买家知道收款信息；这不是匿名结算。",
              )}
            </div>
            <a href="/x-pay-paths.md" download className="button full-width">
              {t("Read the payment routes", "下载支付路径说明")}
            </a>
          </aside>
        </div>
      ) : (
        <div className="desk-form-grid">
          <section className="desk-box">
            <div className="operation-heading">
              <h2>{t("Track a payment", "查询付款")}</h2>
              <button
                className="icon-button"
                aria-label={t("Refresh orders", "刷新订单")}
                onClick={() =>
                  void action("orders", async () => {
                    if (account)
                      setOrders(await api("orders?owner=" + account));
                    if (orderId) await checkOrder();
                  })
                }
              >
                <RefreshCw size={16} />
              </button>
            </div>
            <label>
              {t("Peer deposit ID", "Peer 订单编号")}
              <input
                value={orderId}
                onChange={(e) => {
                  setOrderId(e.target.value);
                  setOrder(null);
                }}
                placeholder="0xEscrow_onchainId"
              />
            </label>
            <button
              className="button"
              disabled={!!busy || !orderId}
              onClick={() => void action("order", () => checkOrder())}
            >
              {t("Read order", "读取订单")}
            </button>
            {!account && (
              <p className="help">
                {t(
                  "Connect a wallet to list its orders, or paste a saved deposit ID.",
                  "连接钱包列出订单，或粘贴已保存的订单编号。",
                )}
              </p>
            )}
            {account && orders.length === 0 && (
              <div className="desk-empty">
                <Send size={24} />
                <h2>{t("No orders loaded", "暂未读取到订单")}</h2>
                <p>
                  {t(
                    "A signed deposit receipt is the starting point. A quote is not an order.",
                    "以已确认入金回执为起点，报价不代表已经下单。",
                  )}
                </p>
              </div>
            )}
            {orders.map((o) => (
              <button
                className="order-row"
                key={o.depositId}
                onClick={() =>
                  void action("order", () => checkOrder(o.depositId))
                }
              >
                <span>{o.depositId}</span>
                <b>{status(o.state)}</b>
              </button>
            ))}
          </section>
          <aside className="desk-box">
            <h2>{t("Payment status", "付款状态")}</h2>
            {order ? (
              <>
                <div className="state-callout">
                  <b>{status(order.state)}</b>
                  <p>
                    {t(
                      "Escrow status reflects USDC movements. Verify fiat payment details below; a manual release is not a cash-payment proof.",
                      "金库状态反映 USDC 变化。请核对下方实际付款资料；手动释放资金不是现金付款证明。",
                    )}
                  </p>
                </div>
                <dl className="financial-summary">
                  <div>
                    <dt>{t("Deposited", "已入金")}</dt>
                    <dd>{formatUnits(order.totalAmount, 6)} USDC</dd>
                  </div>
                  <div>
                    <dt>{t("USDC released", "USDC 已释放")}</dt>
                    <dd>{formatUnits(order.filledAmount, 6)} USDC</dd>
                  </div>
                  <div>
                    <dt>{t("Returned", "已退回")}</dt>
                    <dd>{formatUnits(order.returnedAmount, 6)} USDC</dd>
                  </div>
                </dl>
                {order.fills?.map((f: any) => (
                  <div className="state-callout" key={f.intentHash}>
                    <b>
                      {f.status === "FULFILLED" &&
                      typeof f.fiatPaid === "number" &&
                      f.fiatPaid > 0 &&
                      f.paymentId
                        ? t("Verified payment", "已验证付款")
                        : t("Cash payment unverified", "现金付款未验证")}
                    </b>
                    <p>
                      {f.fiatPaid == null
                        ? "—"
                        : f.fiatPaid + " " + (f.paidCurrency || "USD")}
                    </p>
                    {f.paymentId && (
                      <code className="address-line">{f.paymentId}</code>
                    )}
                  </div>
                ))}
                {order.nextActions?.includes("withdraw") && (
                  <>
                    <button
                      className="button full-width"
                      disabled={!!busy || !!pending}
                      onClick={() => void action("withdraw", withdraw)}
                    >
                      {t("Withdraw available funds", "提现可退回资金")}
                    </button>
                    <p className="help">
                      {t(
                        "Withdrawal requires the original wallet signature. Agent ID is not required to recover your funds.",
                        "提现需要原钱包签名，取回资金不要求继续持有 Agent ID。",
                      )}
                    </p>
                    {!session && (
                      <button
                        className="button"
                        onClick={() => void action("verify", authenticate)}
                      >
                        {t("Verify wallet ownership", "验证钱包控制权")}
                      </button>
                    )}
                  </>
                )}
              </>
            ) : (
              <div className="desk-empty">
                <ShieldCheck size={28} />
                <p>
                  {t(
                    "Load an order to inspect matching, verified fills and available recovery actions.",
                    "读取订单后查看匹配、已验证付款与可用的资金恢复操作。",
                  )}
                </p>
              </div>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
