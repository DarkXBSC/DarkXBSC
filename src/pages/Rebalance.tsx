import { Link } from "react-router-dom";
import { FlowDiagram } from "../components/MotionDetails";
import { useState } from "react";
import {
  Interface,
  hexlify,
  randomBytes,
  keccak256,
  isHexString,
  formatUnits,
} from "ethers";
import { ArrowRight, ArrowLeftRight, Copy } from "lucide-react";
import { useApp } from "../lib/context";
import { PageTitle, CopyText } from "../components/Frame";
import {
  Chain,
  Contract,
  rpc,
  abi,
  asset,
  erc20,
  units,
  ZeroAddress,
  errorCode,
  approveExact,
} from "../lib/chain";
export default function Rebalance() {
  const app = useApp(),
    { t, config, busy, setMessage } = app;
  const [plan, setPlan] = useState({
      a: "",
      b: "",
      pa: "",
      pb: "",
      weight: "50",
      cost: "0",
    }),
    [result, setResult] = useState<any>(null),
    [tab, setTab] = useState("plan"),
    [chain, setChain] = useState<Chain>("bsc"),
    [token, setToken] = useState(ZeroAddress),
    [recipient, setRecipient] = useState(""),
    [amount, setAmount] = useState(""),
    [secret, setSecret] = useState(""),
    [secretHash, setSecretHash] = useState(""),
    [hours, setHours] = useState("24"),
    [id, setId] = useState(""),
    [lockInfo, setLockInfo] = useState<any>(null);
  const d = config?.chains[chain].contracts.inventory;
  const update = (k: string, v: string) => {
    setPlan((x) => ({ ...x, [k]: v }));
    setResult(null);
  };
  function calculate() {
    const { a, b, pa, pb, weight, cost } = Object.fromEntries(
      Object.entries(plan).map(([k, v]) => [k, Number(v)]),
    );
    if (
      !plan.a ||
      !plan.b ||
      !plan.pa ||
      !plan.pb ||
      ![a, b, pa, pb, weight, cost].every(Number.isFinite) ||
      a < 0 ||
      b < 0 ||
      pa <= 0 ||
      pb <= 0 ||
      weight < 0 ||
      weight > 100 ||
      cost < 0
    )
      return setMessage(
        t(
          "Enter both inventories, positive prices and a target weight from 0 to 100.",
          "请填写两端库存、正数价格，以及 0–100 的目标比例。",
        ),
      );
    const va = a * pa,
      vb = b * pb,
      total = va + vb,
      targetA = (total * weight) / 100,
      delta = targetA - va;
    setResult({
      va,
      vb,
      total,
      delta,
      targetA: targetA / pa,
      targetB: (total - targetA) / pb,
      share: total ? (va / total) * 100 : 50,
      priceGap: (pb / pa - 1) * 100,
      net: Math.abs(delta) - cost,
    });
  }
  function generate() {
    const value = hexlify(randomBytes(32));
    setSecret(value);
    setSecretHash(keccak256(value));
  }
  async function approve() {
    if (!d) return;
    try {
      const a = await asset(chain, token);
      await approveExact(
        chain,
        token,
        d.address,
        units(amount, a.decimals),
        app.transact,
        "Approve inventory lock",
      );
    } catch (e) {
      setMessage(errorCode(e));
    }
  }
  async function create() {
    if (!d) return setMessage("INVENTORY_NOT_DEPLOYED");
    try {
      if (!isHexString(secretHash, 32)) throw Error("INVALID_SECRET_HASH");
      const duration = Number(hours);
      if (!Number.isFinite(duration) || duration < 1 / 6 || duration > 720)
        throw Error("INVALID_EXPIRY");
      const decimals =
          token === ZeroAddress ? 18 : (await asset(chain, token)).decimals,
        quantity = units(amount, decimals);
      const data = new Interface(
        await abi("TigerInventory"),
      ).encodeFunctionData("lock", [
        token,
        recipient,
        quantity,
        secretHash,
        Math.floor(Date.now() / 1000 + duration * 3600),
        hexlify(randomBytes(32)),
      ]);
      const r = await app.transact(
        chain,
        { to: d.address, data, value: token === ZeroAddress ? quantity : 0n },
        "Lock inventory",
      );
      const iface = new Interface(await abi("TigerInventory"));
      const event = r.logs
        .filter((l) => l.address.toLowerCase() === d.address.toLowerCase())
        .map((l) => {
          try {
            return iface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((l) => l?.name === "Locked");
      if (event) {
        setId(event.args.id);
        setTab("manage");
        setMessage(
          t(
            "Inventory locked. Save the ID and keep the secret private until both legs are verified.",
            "库存已锁定，请保存编号，在双方交割条件核对前保密 secret。",
          ),
        );
      }
    } catch (e) {
      setMessage(errorCode(e));
    }
  }
  async function inspect() {
    if (!d) return;
    try {
      if (!isHexString(id, 32)) throw Error("INVALID_LOCK_ID");
      const c = new Contract(
          d.address,
          await abi("TigerInventory"),
          rpc(chain),
        ),
        v = await c.locks(id);
      if (Number(v.state) === 0) throw Error("LOCK_NOT_FOUND");
      const decimals =
        v.token === ZeroAddress ? 18 : (await asset(chain, v.token)).decimals;
      setLockInfo({
        sender: v.sender,
        recipient: v.recipient,
        token: v.token,
        amount: formatUnits(v.amount, decimals),
        hash: v.secretHash,
        expiry: Number(v.expiry),
        state: Number(v.state),
      });
    } catch (e) {
      setLockInfo(null);
      setMessage(errorCode(e));
    }
  }
  async function action(name: "claim" | "refund") {
    if (!d) return;
    try {
      if (name === "claim" && !isHexString(secret, 32))
        throw Error("INVALID_SECRET");
      const args = name === "claim" ? [id, secret] : [id];
      await app.transact(
        chain,
        {
          to: d.address,
          data: new Interface(await abi("TigerInventory")).encodeFunctionData(
            name,
            args,
          ),
        },
        name === "claim" ? "Claim inventory" : "Refund inventory",
      );
      await inspect();
    } catch (e) {
      setMessage(errorCode(e));
    }
  }
  return (
    <>
      <PageTitle
        title={t("Inventory", "库存管理")}
        description={t(
          "Plan by inventory value. Exchange by explicit terms. A shared project identity is not a price peg.",
          "按库存价值规划，按明确条款交割。共同的项目身份不是价格锚定。",
        )}
      />
      <div className="trade-layout">
        <section>
          <div className="segmented">
            {[
              ["plan", "Inventory plan", "库存规划"],
              ["lock", "Create lock", "创建锁定"],
              ["manage", "Claim / refund", "领取 / 退款"],
            ].map(([v, en, cn]) => (
              <button
                key={v}
                className={tab === v ? "selected" : ""}
                onClick={() => setTab(v)}
              >
                {t(en, cn)}
              </button>
            ))}
          </div>
          {tab === "plan" ? (
            <>
              <h2>{t("BALANCE THE INVENTORY.", "平衡两端库存。")}</h2>
              <p>
                {t(
                  "Enter prices in the same currency. These are your inputs, not an oracle or a trading quote.",
                  "价格必须使用同一种计价货币。这些是你填写的规划参数，不是预言机价格或交易报价。",
                )}
              </p>
              <div className="planner-columns">
                <div>
                  <h3>{t("BSC · asset A", "BSC · 资产 A")}</h3>
                  <label>
                    {t("Inventory units", "库存数量")}
                    <input
                      value={plan.a}
                      onChange={(e) => update("a", e.target.value)}
                      placeholder="0.0"
                    />
                  </label>
                  <label>
                    {t("Price per token", "每枚代币价格")}
                    <input
                      value={plan.pa}
                      onChange={(e) => update("pa", e.target.value)}
                      placeholder="0.0"
                    />
                  </label>
                </div>
                <ArrowLeftRight size={23} />
                <div>
                  <h3>{t("BSC · asset B", "BSC · 资产 B")}</h3>
                  <label>
                    {t("Inventory units", "库存数量")}
                    <input
                      value={plan.b}
                      onChange={(e) => update("b", e.target.value)}
                      placeholder="0.0"
                    />
                  </label>
                  <label>
                    {t("Price per token", "每枚代币价格")}
                    <input
                      value={plan.pb}
                      onChange={(e) => update("pb", e.target.value)}
                      placeholder="0.0"
                    />
                  </label>
                </div>
              </div>
              <div className="field-row">
                <label>
                  {t("Asset A target weight (%)", "资产 A 目标价值占比（%）")}
                  <input
                    value={plan.weight}
                    onChange={(e) => update("weight", e.target.value)}
                  />
                </label>
                <label>
                  {t(
                    "Estimated total costs (same currency)",
                    "预计总费用（同种计价货币）",
                  )}
                  <input
                    value={plan.cost}
                    onChange={(e) => update("cost", e.target.value)}
                  />
                </label>
              </div>
              <button className="button primary" onClick={calculate}>
                {t("Calculate inventory targets", "计算库存目标")}
                <ArrowRight size={16} />
              </button>
              {result && (
                <div className="plan-result">
                  <div className="allocation">
                    <div style={{ width: result.share + "%" }} />
                    <i style={{ left: plan.weight + "%" }} />
                  </div>
                  <div className="allocation-labels">
                    <span>A {result.share.toFixed(1)}%</span>
                    <span>B {(100 - result.share).toFixed(1)}%</span>
                  </div>
                  <dl>
                    <div>
                      <dt>{t("Target units of A", "资产 A 目标数量")}</dt>
                      <dd>
                        {result.targetA.toLocaleString(undefined, {
                          maximumFractionDigits: 6,
                        })}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("Target units of B", "资产 B 目标数量")}</dt>
                      <dd>
                        {result.targetB.toLocaleString(undefined, {
                          maximumFractionDigits: 6,
                        })}
                      </dd>
                    </div>
                    <div>
                      <dt>
                        {t("Value to shift toward BSC", "应向 BSC 调整的价值")}
                      </dt>
                      <dd>
                        {result.delta.toLocaleString(undefined, {
                          maximumFractionDigits: 6,
                        })}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("Input price difference", "输入价格差异")}</dt>
                      <dd>{result.priceGap.toFixed(2)}%</dd>
                    </div>
                  </dl>
                  <p>
                    {result.net <= 0
                      ? t(
                          "Your entered costs equal or exceed the planned value shift. Consider leaving inventory unchanged.",
                          "你填写的费用不低于拟调整价值，可以考虑保留当前库存。",
                        )
                      : t(
                          "Use these targets to negotiate an exchange. Recheck prices, fees and available liquidity before locking assets.",
                          "可以据此协商库存交换。在锁定资产前重新核对价格、费用及流动性。",
                        )}
                  </p>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="field-row">
                <label>
                  {t("Settlement network", "交割网络")}
                  <select
                    value={chain}
                    onChange={(e) => {
                      setChain(e.target.value as Chain);
                      setLockInfo(null);
                    }}
                  >
                    <option value="bsc">BSC</option>
                  </select>
                </label>
                <div className="network-state">
                  {d
                    ? t("Contract deployed", "合约已部署")
                    : t("Deployment deferred", "暂缓部署")}
                </div>
              </div>
              {tab === "lock" ? (
                <>
                  <h2>{t("LOCK WITH AN EXIT.", "锁定，也保留退出路径。")}</h2>
                  <label>
                    {t(
                      "Asset address (zero address = native coin)",
                      "资产地址（零地址表示原生币）",
                    )}
                    <input
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                    />
                  </label>
                  <div className="field-row">
                    <label>
                      {t("Amount", "数量")}
                      <input
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.0"
                      />
                    </label>
                    <label>
                      {t("Expires in (hours)", "到期时间（小时后）")}
                      <input
                        value={hours}
                        onChange={(e) => setHours(e.target.value)}
                      />
                    </label>
                  </div>
                  <label>
                    {t("Recipient", "接收方")}
                    <input
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                      placeholder="0x…"
                    />
                  </label>
                  <label>
                    {t("Secret hash", "Secret 哈希")}
                    <input
                      value={secretHash}
                      onChange={(e) => setSecretHash(e.target.value)}
                      placeholder="0x…"
                    />
                  </label>
                  <button className="text-button" onClick={generate}>
                    {t("Generate a new secret locally", "在本地生成新 secret")}
                    <ArrowRight size={14} />
                  </button>
                  {secret && (
                    <div className="secret-panel">
                      <b>
                        {t(
                          "Keep this secret private. Save it outside this page.",
                          "请保密并在页面外安全保存这个 secret。",
                        )}
                      </b>
                      <CopyText value={secret} />
                      <p>
                        {t(
                          "It is not stored by Dark. Revealing it on either chain lets the counterparty claim the matching lock.",
                          "Dark 不存储此 secret。在任一链公开后，对手方即可领取对应锁定资产。",
                        )}
                      </p>
                    </div>
                  )}
                  <div className="form-actions">
                    {token !== ZeroAddress && (
                      <button
                        className="button"
                        disabled={busy || !d}
                        onClick={() => void approve()}
                      >
                        {t("Approve exact amount", "授权精确数量")}
                      </button>
                    )}
                    <button
                      className="button primary"
                      disabled={busy || !d}
                      onClick={() => void create()}
                    >
                      {t("Review lock in my wallet", "在钱包中确认锁定")}
                      <ArrowRight size={15} />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h2>{t("FOLLOW THE LOCK.", "跟踪交割状态。")}</h2>
                  <label>
                    {t("Lock ID", "锁定编号")}
                    <input
                      value={id}
                      onChange={(e) => {
                        setId(e.target.value);
                        setLockInfo(null);
                      }}
                      placeholder="0x…"
                    />
                  </label>
                  <button
                    className="button"
                    disabled={!d}
                    onClick={() => void inspect()}
                  >
                    {t("Read from chain", "读取链上状态")}
                  </button>
                  {lockInfo && (
                    <>
                      <dl>
                        <div>
                          <dt>{t("Status", "状态")}</dt>
                          <dd>
                            {lockInfo.state === 1
                              ? t("Locked", "锁定中")
                              : lockInfo.state === 2
                                ? t("Claimed", "已领取")
                                : t("Refunded", "已退款")}
                          </dd>
                        </div>
                        <div>
                          <dt>{t("Amount", "数量")}</dt>
                          <dd>{lockInfo.amount}</dd>
                        </div>
                        <div>
                          <dt>{t("Expiry", "到期时间")}</dt>
                          <dd>
                            {new Date(lockInfo.expiry * 1000).toLocaleString()}
                          </dd>
                        </div>
                      </dl>
                      <label>
                        {t("Recipient", "接收方")}
                        <CopyText value={lockInfo.recipient} />
                      </label>
                      <label>
                        {t("Refund address", "退款地址")}
                        <CopyText value={lockInfo.sender} />
                      </label>
                      <label>
                        Secret
                        <input
                          value={secret}
                          onChange={(e) => setSecret(e.target.value)}
                          placeholder="0x…"
                        />
                      </label>
                      <div className="form-actions">
                        <button
                          className="button"
                          disabled={busy || lockInfo.state !== 1}
                          onClick={() => void action("refund")}
                        >
                          {t("Refund after expiry", "到期后退款")}
                        </button>
                        <button
                          className="button primary"
                          disabled={busy || lockInfo.state !== 1}
                          onClick={() => void action("claim")}
                        >
                          {t("Claim with secret", "使用 secret 领取")}
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </section>
        <aside className="reading-aside">
          <FlowDiagram kind="inventory" />
          <h3>
            {t(
              "Two markets, explicit obligations.",
              "两个市场，明确的交割责任。",
            )}
          </h3>
          <p>
            {t(
              "A hash-time lock holds the agreed assets until the matching secret is revealed or the refund time arrives. It cannot mint assets on another chain.",
              "哈希锁保管约定资产，直到正确 secret 被公开或退款时间到达。它不能在另一条链铸造资产。",
            )}
          </p>
          <p>
            {t(
              "Verify both locks, recipients, amounts and the same secret hash. Use staggered expiries with enough time for confirmations. Do not reveal the secret before the counter-lock is confirmed.",
              "核对双方锁定记录、接收方、数量及相同 secret 哈希。到期时间应错开并预留确认余量；对方锁定确认前，不要公开 secret。",
            )}
          </p>

          <Link to="/app/learn">
            {t("Read the settlement guide", "阅读交割教程")}
            <ArrowRight size={15} />
          </Link>
        </aside>
      </div>
    </>
  );
}
