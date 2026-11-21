import { Link } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Download, ShieldCheck } from "lucide-react";
import { formatUnits } from "ethers";
import { useApp } from "../lib/context";
import { PageTitle, CopyText } from "../components/Frame";
import { PAY_NETWORK, planPayments, type PayPlanInput } from "../lib/agent-pay";
import "../pay.css";

async function read(url: string, body?: unknown) {
  const response = await fetch(
    url,
    body
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "SERVICE_UNAVAILABLE");
  return data;
}
export default function AgentPay() {
  const { t, account } = useApp();
  const [mode, setMode] = useState("meme"),
    [tab, setTab] = useState("program");
  const [plan, setPlan] = useState<PayPlanInput>({
    received: "1000",
    reserve: "20",
    impactPercent: "50",
    creators: "20",
    perPersonCap: "25",
  });
  const [address, setAddress] = useState(account),
    [identity, setIdentity] = useState<any>(null),
    [lookupBusy, setLookupBusy] = useState(false),
    [identityError, setIdentityError] = useState("");
  const [route, setRoute] = useState({
      asset: "BNB",
      amount: "0.1",
      fromAddress: account,
      toAddress: "",
    }),
    [quote, setQuote] = useState<any>(null),
    [quoteBusy, setQuoteBusy] = useState(false),
    [quoteError, setQuoteError] = useState("");
  const [destination, setDestination] = useState<any>(null),
    [destinationError, setDestinationError] = useState(false),
    [now, setNow] = useState(Date.now());
  const idRequest = useRef(0),
    quoteRequest = useRef(0);
  useEffect(() => {
    if (account) {
      setAddress(account);
      setIdentity(null);
      ++idRequest.current;
      setLookupBusy(false);
      setRoute((r) => ({ ...r, fromAddress: account }));
      setQuote(null);
      ++quoteRequest.current;
      setQuoteBusy(false);
    }
  }, [account]);
  useEffect(() => {
    let alive = true;
    read("/api/agent-pay/destination")
      .then((v) => alive && setDestination(v))
      .catch(() => alive && setDestinationError(true));
    return () => {
      alive = false;
      ++idRequest.current;
      ++quoteRequest.current;
    };
  }, []);
  useEffect(() => {
    if (!quote) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [quote]);
  const allocation = useMemo(() => {
    try {
      return planPayments(plan);
    } catch {
      return null;
    }
  }, [plan]);
  const stale =
    quote && now - Date.parse(quote.fetchedAt) >= quote.staleAfterMs;
  function updatePlan(key: keyof PayPlanInput, value: string) {
    setPlan((p) => ({ ...p, [key]: value }));
  }
  function updateRoute(key: string, value: string) {
    ++quoteRequest.current;
    setQuoteBusy(false);
    setQuote(null);
    setQuoteError("");
    setRoute((r) => ({ ...r, [key]: value }));
  }
  async function checkIdentity() {
    const seq = ++idRequest.current;
    setLookupBusy(true);
    setIdentityError("");
    setIdentity(null);
    try {
      const result = await read(
        "/api/agent-pay/identity?address=" + encodeURIComponent(address),
      );
      if (seq === idRequest.current) setIdentity(result);
    } catch (e) {
      if (seq === idRequest.current) setIdentityError((e as Error).message);
    } finally {
      if (seq === idRequest.current) setLookupBusy(false);
    }
  }
  async function getQuote() {
    const seq = ++quoteRequest.current;
    setQuoteBusy(true);
    setQuoteError("");
    setQuote(null);
    try {
      const result = await read("/api/agent-pay/quote", route);
      if (seq === quoteRequest.current) {
        setQuote(result);
        setNow(Date.now());
      }
    } catch (e) {
      if (seq === quoteRequest.current) setQuoteError((e as Error).message);
    } finally {
      if (seq === quoteRequest.current) setQuoteBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        title={t("Treasury planning", "资金计划")}
        description={t(
          "Estimate treasury allocations and review Agent ID permissions.",
          "估算金库分配，核对 Agent ID 执行权限。",
        )}
      />
      <div className="pay-disclosure">
        <ShieldCheck size={18} />
        <p>
          {t(
            "Plan treasury allocations here. Choose X Money giving when launching a Flap token. Track its payments in Giving.",
            "在这里规划金库分配；发行 Flap 代币时选择 X Money 公益，之后在公益页核对该代币的实际付款。",
          )}
        </p>
      </div>
      <div
        className="pay-flow"
        aria-label={t("Proposed payment flow", "拟定付款流程")}
      >
        {[
          ["01", "MEME TAX", "Meme 税收"],
          ["02", "BASE / USDC", "Base / USDC"],
          ["03", "AGENT POLICY", "Agent 授权"],
          ["04", "DIRECT DELIVERY", "自动到账"],
        ].map(([n, en, cn], i) => (
          <div key={n}>
            <span>{n}</span>
            <strong>{t(en, cn)}</strong>
            {i < 3 && <ArrowRight size={18} />}
          </div>
        ))}
      </div>
      <div
        className="pay-tabs"
        role="tablist"
        aria-label={t("Agent Pay sections", "Agent Pay 功能")}
      >
        {[
          ["program", "01 / DESIGN A PROGRAM", "01 / 设计计划"],
          ["route", "02 / VERIFY THE RAILS", "02 / 验证支付路径"],
          ["privacy", "03 / PRIVACY & DELIVERY", "03 / 隐私与到账"],
        ].map(([id, en, cn], index) => (
          <button
            key={id}
            role="tab"
            tabIndex={tab === id ? 0 : -1}
            aria-selected={tab === id}
            aria-controls={"pay-panel-" + id}
            id={"pay-tab-" + id}
            onClick={() => setTab(id)}
            onKeyDown={(e) => {
              const next =
                e.key === "ArrowRight"
                  ? (index + 1) % 3
                  : e.key === "ArrowLeft"
                    ? (index + 2) % 3
                    : e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? 2
                        : -1;
              if (next < 0) return;
              e.preventDefault();
              setTab(["program", "route", "privacy"][next]);
              e.currentTarget.parentElement
                ?.querySelectorAll<HTMLButtonElement>("button")
                [next].focus();
            }}
          >
            {t(en, cn)}
          </button>
        ))}
      </div>
      <section
        key={tab}
        role="tabpanel"
        id={"pay-panel-" + tab}
        aria-labelledby={"pay-tab-" + tab}
        className="pay-panel"
      >
        {tab === "program" && (
          <div className="pay-columns">
            <div>
              <h2>{t("Make the tax useful.", "让税收产生用途。")}</h2>
              <div className="pay-programs">
                {[
                  [
                    "meme",
                    "Meme → Meaning",
                    "Meme 创作者回馈",
                    "Reward approved original work; route a share to a vetted cause.",
                    "奖励经审核的原创作品，同时将一部分资金用于核验过的公益项目。",
                  ],
                  [
                    "care",
                    "Quiet Support",
                    "低曝光公益支持",
                    "Fund verified recipients without a public social leaderboard.",
                    "为核验过的受助者付款，不公开社交身份排行榜。",
                  ],
                  [
                    "tools",
                    "Agent Commons",
                    "Agent 公共工具",
                    "Reserve a capped budget for x402 research and community services.",
                    "为 x402 研究与社区服务设置独立、有限额的支出预算。",
                  ],
                ].map(([id, en, cn, desc, descCn]) => (
                  <button
                    key={id}
                    className="pay-program"
                    aria-pressed={mode === id}
                    onClick={() => setMode(id)}
                  >
                    <span>{mode === id ? "●" : "○"}</span>
                    <div>
                      <strong>{t(en, cn)}</strong>
                      <p>{t(desc, descCn)}</p>
                    </div>
                  </button>
                ))}
              </div>
              <p className="pay-note">
                {t(
                  "Program design only. Recipients, purpose checks and service allowlists must be approved before execution. Agent ID alone is not proof of a unique human.",
                  "这里只选择计划方向；执行前仍需批准收款人、用途核验及服务白名单。Agent ID 本身不是唯一真人证明。",
                )}
              </p>
            </div>
            <div className="pay-budget">
              <span className="pay-label">
                {t(
                  "ILLUSTRATIVE BUDGET / NOT A LIVE BALANCE",
                  "示例预算 / 并非实际余额",
                )}
              </span>
              <div className="pay-fields">
                {(
                  [
                    ["received", "Received USDC", "已到账 USDC"],
                    ["reserve", "Cost reserve · USDC", "成本预留 · USDC"],
                    ["impactPercent", "Impact share · %", "公益比例 · %"],
                    ["creators", "Recipient count", "收款人数"],
                    [
                      "perPersonCap",
                      "Per-person cap · USDC",
                      "每人上限 · USDC",
                    ],
                  ] as const
                ).map(([k, en, cn]) => (
                  <label key={k}>
                    {t(en, cn)}
                    <input
                      inputMode="decimal"
                      value={plan[k]}
                      onChange={(e) => updatePlan(k, e.target.value)}
                    />
                  </label>
                ))}
              </div>
              {allocation ? (
                <div className="pay-allocation" aria-live="polite">
                  {(
                    [
                      ["impact", "Impact budget", "公益预算"],
                      [
                        "creatorTotal",
                        mode === "tools"
                          ? "Service budget envelope"
                          : "Recipient pool",
                        mode === "tools" ? "服务预算额度" : "收款人资金池",
                      ],
                      ["reserve", "Reserved costs", "预留成本"],
                      ["carry", "Retained remainder", "留存余额"],
                    ] as const
                  ).map(([key, en, cn]) => (
                    <div key={key}>
                      <span>{t(en, cn)}</span>
                      <strong>
                        {allocation.display[key]} <small>USDC</small>
                      </strong>
                    </div>
                  ))}
                  <p>
                    {t("Maximum per recipient", "每位收款人最高")}{" "}
                    <b>{allocation.display.each} USDC</b>
                  </p>
                </div>
              ) : (
                <p className="pay-error" role="alert">
                  {t(
                    "Use positive USDC amounts with up to 6 decimals, costs below receipts, a 0–100% share and 1–99,999 recipients.",
                    "请填写最多 6 位小数的正数金额；成本低于到账额、比例 0–100%、人数 1–99,999。",
                  )}
                </p>
              )}
              <Link className="button primary" to="/app/impact">
                {t("Set up tax distributions", "设置税收分配")}
                <ArrowRight size={15} />
              </Link>
            </div>
          </div>
        )}
        {tab === "route" && (
          <div className="pay-columns">
            <div>
              <h2>{t("Know the operator.", "核验执行者。")}</h2>
              <p className="pay-context">
                {t(
                  "Check Agent ID on BNB Smart Chain.",
                  "在 BNB Smart Chain 核验 Agent ID。",
                )}
              </p>
              <label>
                {t("Agent wallet address", "Agent 钱包地址")}
                <input
                  value={address}
                  placeholder="0x…"
                  onChange={(e) => {
                    setAddress(e.target.value);
                    ++idRequest.current;
                    setLookupBusy(false);
                    setIdentity(null);
                    setIdentityError("");
                  }}
                />
              </label>
              <button
                className="button"
                onClick={checkIdentity}
                disabled={lookupBusy}
              >
                {lookupBusy
                  ? t("Checking BSC…", "正在查询 BSC…")
                  : t("Check Agent ID", "核验 Agent ID")}
              </button>
              {identity && (
                <div className="pay-readout" aria-live="polite">
                  <strong>
                    {identity.eligible
                      ? t("Agent ID held", "持有 Agent ID")
                      : t(
                          "No Agent ID at this address",
                          "该地址未持有 Agent ID",
                        )}
                  </strong>
                  <p>
                    BSC / {t("Block", "区块")} {identity.block} ·{" "}
                    {t("Balance", "数量")} {identity.balance}
                  </p>
                  <p>
                    {t(
                      "This is a public address lookup, not wallet authentication or a spending grant.",
                      "这是公开地址查询，不等于钱包身份认证或支出授权。",
                    )}
                  </p>
                </div>
              )}
              {identityError && (
                <p className="pay-error" role="alert">
                  {t(
                    "Unable to verify. Check the address and retry.",
                    "核验失败，请检查地址后重试。",
                  )}{" "}
                  ({identityError})
                </p>
              )}
              <div className="pay-readout">
                <span className="pay-label">BASE / CANONICAL USDC</span>
                <CopyText value={PAY_NETWORK.usdc} />
                <p>
                  {destination
                    ? t(
                        "Verified on Base, 6 decimals. Block ",
                        "已从 Base 核验，6 位精度。区块 ",
                      ) + destination.block
                    : destinationError
                      ? t(
                          "Live verification unavailable. Retry by reloading.",
                          "暂时无法实时核验，请刷新重试。",
                        )
                      : t("Verifying token contract…", "正在核验代币合约…")}
                </p>
              </div>
            </div>
            <div>
              <h2>{t("Fund the payout pool.", "补充支付资金池。")}</h2>
              <p className="pay-context">
                {t(
                  "BSC to Base · read-only route quote.",
                  "BSC 至 Base · 只读路径报价。",
                )}
              </p>
              <div className="pay-fields">
                <label>
                  {t("Source asset", "来源资产")}
                  <select
                    value={route.asset}
                    onChange={(e) => updateRoute("asset", e.target.value)}
                  >
                    <option>BNB</option>
                    <option>USDT</option>
                  </select>
                </label>
                <label>
                  {t("Source amount", "来源金额")}
                  <input
                    value={route.amount}
                    onChange={(e) => updateRoute("amount", e.target.value)}
                  />
                </label>
              </div>
              <label>
                {t("Source treasury address", "来源资金地址")}
                <input
                  value={route.fromAddress}
                  placeholder="0x…"
                  onChange={(e) => updateRoute("fromAddress", e.target.value)}
                />
              </label>
              <label>
                {t("Base treasury address", "Base 收款资金池地址")}
                <input
                  value={route.toAddress}
                  placeholder="0x…"
                  onChange={(e) => updateRoute("toAddress", e.target.value)}
                />
              </label>
              <button
                className="button primary"
                onClick={getQuote}
                disabled={quoteBusy}
              >
                {quoteBusy
                  ? t("Fetching route…", "正在获取路由…")
                  : t("Get live route quote", "获取真实路径报价")}
                <ArrowRight size={16} />
              </button>
              <p className="pay-note">
                {t(
                  "Addresses and amount are sent to LI.FI to obtain this public route quote. No X identity is sent.",
                  "地址与金额会发送给 LI.FI 以获取路径报价；不会发送 X 身份。",
                )}
              </p>
              {quoteError && (
                <p className="pay-error" role="alert">
                  {t(
                    "No verified quote. Check both addresses and amount, then retry.",
                    "未取得通过核验的报价，请检查两端地址与金额后重试。",
                  )}{" "}
                  ({quoteError})
                </p>
              )}
              {quote && (
                <div className="pay-readout" aria-live="polite">
                  <span>
                    {quote.provider} / {quote.tool}
                  </span>
                  <strong>{formatUnits(quote.toAmountMin, 6)} USDC</strong>
                  <p>
                    {t(
                      "Minimum quoted destination amount · slippage 0.5%",
                      "报价中的最低到账额 · 滑点 0.5%",
                    )}
                  </p>
                  <p>
                    {stale
                      ? t(
                          "Quote expired; refresh before using its estimate.",
                          "报价已过期，使用估算前请重新获取。",
                        )
                      : t(
                          "Read-only estimate. Network fees may be additional.",
                          "只读估算，网络费可能另计。",
                        )}
                  </p>
                  <p>
                    {t(
                      "No approval, bridge transaction or payout has been submitted.",
                      "未提交授权、跨链交易或付款。",
                    )}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
        {tab === "privacy" && (
          <div className="pay-columns">
            <div>
              <h2>{t("Pay people directly.", "直接支付给收款人。")}</h2>
              <p className="pay-context">
                {t(
                  "Receive without a per-payment claim transaction.",
                  "接收每笔付款，无需提交领取交易。",
                )}
              </p>
              <ol className="pay-steps">
                <li>
                  <strong>{t("Resolve the X account", "识别 X 账号")}</strong>
                  <p>
                    {t(
                      "Use the stable numeric user ID. A typed handle is not a verified recipient.",
                      "使用稳定的数字 user ID；手输用户名不能视为已核验收款人。",
                    )}
                  </p>
                </li>
                <li>
                  <strong>
                    {t(
                      "Use a bound or pregenerated wallet",
                      "使用已绑定或预生成的钱包",
                    )}
                  </strong>
                  <p>
                    {t(
                      "A wallet service can create an account before first login. The user still signs in with X to access the funds.",
                      "钱包服务可在首次登录前创建账户。用户仍需通过 X 登录，才能访问其中的资产。",
                    )}
                  </p>
                </li>
                <li>
                  <strong>
                    {t("Push USDC automatically", "自动推送 USDC")}
                  </strong>
                  <p>
                    {t(
                      "An authorized operator executes approved payouts. The recipient sends no claim transaction and pays no receiving gas.",
                      "授权执行者按批准清单付款。收款人无需发送领取交易，也无需为接收支付 Gas。",
                    )}
                  </p>
                </li>
              </ol>
              <p className="pay-note">
                {t(
                  "X wallet provisioning is documented but not connected or end-to-end tested in this preview.",
                  "当前已完成 X 钱包预生成的接口研究，但尚未接通、也未完成端到端验证。",
                )}
              </p>
            </div>
            <div>
              <h2>{t("Be precise about privacy.", "明确隐私的边界。")}</h2>
              <p className="pay-context">
                {t(
                  "Keep social identity offchain; settlement remains public.",
                  "社交身份留在链下，结算记录仍然公开。",
                )}
              </p>
              <div className="pay-principle">
                <strong>
                  {t("Keep identities offchain", "身份资料留在链下")}
                </strong>
                <p>
                  {t(
                    "Encrypt X-to-wallet mappings. Publish random receipt references, never plain usernames or unsalted username hashes.",
                    "加密存储 X 与钱包映射；公开随机回执编号，不公开用户名或可枚举的无盐哈希。",
                  )}
                </p>
              </div>
              <div className="pay-principle">
                <strong>
                  {t("USDC transfers remain visible", "USDC 转账仍然公开")}
                </strong>
                <p>
                  {t(
                    "Base exposes sender, recipient and amount. This design reduces identity exposure; it does not provide anonymous or hidden-value transfers.",
                    "Base 上仍可见付款地址、收款地址和金额。此设计减少身份曝光，不提供匿名转账或隐藏金额。",
                  )}
                </p>
              </div>
              <div className="pay-principle">
                <strong>
                  {t(
                    "Receipts prove payment, not impact",
                    "回执证明付款，不自动证明公益",
                  )}
                </strong>
                <p>
                  {t(
                    "Validate the beneficiary and use of funds separately. A nonprofit partner and reports must be confirmed before public impact claims.",
                    "受益方身份与资金用途需另行核验。公益合作方和报告确认后，才能对外声称产生了公益成果。",
                  )}
                </p>
              </div>
              <a
                className="text-button"
                href="/agent-pay-technical.md"
                download
              >
                {t("Download the technical design", "下载详细技术设计")}{" "}
                <Download size={15} />
              </a>
            </div>
          </div>
        )}
      </section>
      <section className="pay-readiness">
        <h2>{t("Build status.", "当前进度。")}</h2>
        <div>
          {[
            [
              "Agent ID + route",
              "Agent ID 与跨链路径",
              "Live read-only queries",
              "真实只读查询",
            ],
            [
              "Payment vault",
              "批量付款合约",
              "Local candidate · undeployed",
              "本地合约原型 · 未部署",
            ],
            [
              "X delivery",
              "X 自动收款",
              "X login wallet · pending",
              "待接入身份与钱包服务",
            ],
            [
              "x402 services",
              "x402 服务支付",
              "Designed · not connected",
              "已设计 · 未接入",
            ],
          ].map(([en, cn, s, sc]) => (
            <p key={en}>
              <strong>{t(en, cn)}</strong>
              <span>{t(s, sc)}</span>
            </p>
          ))}
        </div>
      </section>
    </>
  );
}
