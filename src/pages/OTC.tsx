import { Link } from "react-router-dom";
import { FlowDiagram } from "../components/MotionDetails";
import { useEffect, useState } from "react";
import {
  Interface,
  hexlify,
  randomBytes,
  formatUnits,
  recoverAddress,
  isAddress,
} from "ethers";
import {
  ArrowRight,
  ShieldCheck,
  Download,
  Copy,
  Check,
  LockKeyhole,
} from "lucide-react";
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
  chainInfo,
  approveExact,
} from "../lib/chain";
const types = {
  Order: [
    { name: "maker", type: "address" },
    { name: "taker", type: "address" },
    { name: "sellToken", type: "address" },
    { name: "buyToken", type: "address" },
    { name: "sellAmount", type: "uint256" },
    { name: "buyAmount", type: "uint256" },
    { name: "expiry", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "agentOnly", type: "bool" },
  ],
};
export default function OTC({ agent = false }: { agent?: boolean }) {
  const app = useApp(),
    { t, config, account, busy, setMessage } = app;
  const chain: Chain = "bsc";
  const [tab, setTab] = useState("create"),
    [sell, setSell] = useState(
      new URLSearchParams(location.search).get("token") || "",
    ),
    [buy, setBuy] = useState(""),
    [sellAmount, setSellAmount] = useState(""),
    [buyAmount, setBuyAmount] = useState(""),
    [counterparty, setCounterparty] = useState(""),
    [hours, setHours] = useState("24"),
    [packet, setPacket] = useState(""),
    [imported, setImported] = useState<any>(null),
    [minimum, setMinimum] = useState(""),
    [terms, setTerms] = useState<any>(null),
    [nonce, setNonce] = useState(""),
    [eligible, setEligible] = useState<boolean | null>(null),
    [working, setWorking] = useState(false),
    [copied, setCopied] = useState(false);
  const d = config?.chains[chain].contracts.settlement;
  useEffect(() => {
    setPacket("");
    setImported(null);
    setTerms(null);
  }, [agent, chain, account]);
  useEffect(() => {
    let stop = false;
    setEligible(null);
    if (!d || !account || !agent) return;
    abi("TigerSettlement")
      .then((a) => new Contract(d.address, a, rpc(chain)).eligible(account))
      .then((v) => {
        if (!stop) setEligible(v);
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [d?.address, account, agent]);
  async function details() {
    const [s, b] = await Promise.all([asset(chain, sell), asset(chain, buy)]);
    const sa = units(sellAmount, s.decimals),
      ba = units(buyAmount, b.decimals);
    if (sa <= 0n || ba <= 0n || s.address === b.address)
      throw Error("INVALID_AMOUNT");
    return { s, b, sa, ba };
  }
  async function approveSell() {
    if (!d) return setMessage("SETTLEMENT_NOT_DEPLOYED");
    try {
      const { s, sa } = await details();
      await approveExact(
        chain,
        s.address,
        d.address,
        sa,
        app.transact,
        "Approve OTC sale",
      );
    } catch (e) {
      setMessage(errorCode(e));
    }
  }
  async function signQuote() {
    if (!d || !account) return setMessage("CONNECT_WALLET");
    setWorking(true);
    try {
      const { s, b, sa, ba } = await details();
      const contract = new Contract(
        d.address,
        await abi("TigerSettlement"),
        rpc(chain),
      );
      if (agent && !(await contract.eligible(account)))
        throw Error("AGENT_ID_REQUIRED");
      if (
        (await new Contract(s.address, erc20, rpc(chain)).allowance(
          account,
          d.address,
        )) < sa
      )
        throw Error("APPROVE_SELL_FIRST");
      const duration = Number(hours);
      if (!Number.isFinite(duration) || duration <= 0 || duration > 720)
        throw Error("INVALID_EXPIRY");
      const o = {
        maker: account,
        taker: counterparty || ZeroAddress,
        sellToken: s.address,
        buyToken: b.address,
        sellAmount: sa.toString(),
        buyAmount: ba.toString(),
        expiry: Math.floor(Date.now() / 1000 + duration * 3600),
        nonce: BigInt(hexlify(randomBytes(16))).toString(),
        agentOnly: agent,
      };
      const signer = await app.signer(chain);
      const domain = {
        name: "TigerSettlement",
        version: "1",
        chainId: chainInfo[chain].id,
        verifyingContract: d.address,
      };
      const signature = await signer.signTypedData(domain, types, o);
      const result = {
        schema: "tiger-quote-v1",
        chain,
        settlement: d.address,
        order: o,
        signature,
        display: {
          sellSymbol: s.symbol,
          buySymbol: b.symbol,
          sellDecimals: s.decimals,
          buyDecimals: b.decimals,
        },
      };
      setPacket(JSON.stringify(result, null, 2));
      setNonce(o.nonce);
      setMessage(
        t(
          "Quote signed. Share it privately with your counterparty. It has not traded yet.",
          "报价已签名，请私下分享给对手方，尚未成交。",
        ),
      );
    } catch (e) {
      setMessage(errorCode(e));
    } finally {
      setWorking(false);
    }
  }
  async function inspect() {
    if (!d) return setMessage("SETTLEMENT_NOT_DEPLOYED");
    setWorking(true);
    try {
      let p;
      try {
        p = JSON.parse(packet);
      } catch {
        throw Error("QUOTE_FORMAT_INVALID");
      }
      if (
        !p ||
        typeof p !== "object" ||
        typeof p.schema !== "string" ||
        typeof p.chain !== "string" ||
        !isAddress(p.settlement) ||
        !p.order ||
        typeof p.order !== "object" ||
        typeof p.signature !== "string" ||
        !/^0x(?:[\da-fA-F]{2})*$/.test(p.signature) ||
        !["maker", "taker", "sellToken", "buyToken"].every((key) =>
          isAddress(p.order[key]),
        ) ||
        !["sellAmount", "buyAmount", "nonce"].every(
          (key) =>
            typeof p.order[key] === "string" && /^\d+$/.test(p.order[key]),
        ) ||
        !Number.isSafeInteger(p.order.expiry) ||
        p.order.expiry <= 0 ||
        typeof p.order.agentOnly !== "boolean"
      )
        throw Error("QUOTE_FORMAT_INVALID");
      if (
        p.schema !== "tiger-quote-v1" ||
        p.chain !== chain ||
        p.settlement.toLowerCase() !== d.address.toLowerCase() ||
        (agent && !p.order.agentOnly)
      )
        throw Error("QUOTE_DOMAIN_MISMATCH");
      const o = p.order;
      if (
        typeof o.agentOnly !== "boolean" ||
        !isAddress(o.maker) ||
        !isAddress(o.taker) ||
        (account &&
          (o.maker.toLowerCase() === account.toLowerCase() ||
            (o.taker !== ZeroAddress &&
              o.taker.toLowerCase() !== account.toLowerCase())))
      )
        throw Error("QUOTE_COUNTERPARTY_MISMATCH");
      if (
        !/^\d+$/.test(o.sellAmount) ||
        !/^\d+$/.test(o.buyAmount) ||
        Number(o.expiry) <= Date.now() / 1000
      )
        throw Error("QUOTE_EXPIRED_OR_INVALID");
      const [s, b] = await Promise.all([
        asset(chain, o.sellToken),
        asset(chain, o.buyToken),
      ]);
      const contract = new Contract(
        d.address,
        await abi("TigerSettlement"),
        rpc(chain),
      );
      const digest = await contract.hashOrder(o);
      let valid = false;
      try {
        valid =
          (await rpc(chain).getCode(o.maker)) === "0x"
            ? recoverAddress(digest, p.signature).toLowerCase() ===
              o.maker.toLowerCase()
            : (await new Contract(
                o.maker,
                [
                  "function isValidSignature(bytes32,bytes) view returns(bytes4)",
                ],
                rpc(chain),
              ).isValidSignature(digest, p.signature)) === "0x1626ba7e";
      } catch {}
      if (!valid) throw Error("INVALID_QUOTE_SIGNATURE");
      if (await contract.nonceUsed(o.maker, o.nonce))
        throw Error("QUOTE_USED_OR_CANCELLED");
      if (
        o.agentOnly &&
        (!(await contract.eligible(o.maker)) ||
          (account && !(await contract.eligible(account))))
      )
        throw Error("AGENT_ID_REQUIRED");
      setImported(p);
      setTerms({ s, b, fee: await contract.feeFor(o.buyAmount) });
      setMinimum(formatUnits(o.sellAmount, s.decimals));
      setMessage(
        t(
          "Quote decoded. Inspect assets, counterparty and amounts before approving.",
          "报价已解析，请在授权前核对资产、对手方与金额。",
        ),
      );
    } catch (e) {
      setImported(null);
      setTerms(null);
      setMessage(errorCode(e));
    } finally {
      setWorking(false);
    }
  }
  async function approveBuy() {
    if (!d || !imported || !terms) return;
    try {
      const amount = BigInt(imported.order.buyAmount) + terms.fee;
      await approveExact(
        chain,
        imported.order.buyToken,
        d.address,
        amount,
        app.transact,
        "Approve OTC payment",
      );
    } catch (e) {
      setMessage(errorCode(e));
    }
  }
  async function settle() {
    if (!d || !imported || !terms) return;
    try {
      const data = new Interface(
        await abi("TigerSettlement"),
      ).encodeFunctionData("settle", [
        imported.order,
        imported.signature,
        units(minimum, terms.s.decimals),
      ]);
      await app.transact(chain, { to: d.address, data }, "Settle OTC quote");
      setImported(null);
      setTerms(null);
    } catch (e) {
      setMessage(errorCode(e));
    }
  }
  async function cancel() {
    if (!d) return;
    try {
      if (!/^\d+$/.test(nonce)) throw Error("INVALID_NONCE");
      await app.transact(
        chain,
        {
          to: d.address,
          data: new Interface(await abi("TigerSettlement")).encodeFunctionData(
            "cancel",
            [nonce],
          ),
        },
        "Cancel OTC quote",
      );
    } catch (e) {
      setMessage(errorCode(e));
    }
  }
  function download() {
    const u = URL.createObjectURL(
      new Blob([packet], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = u;
    a.download = "tiger-private-quote.json";
    a.click();
    URL.revokeObjectURL(u);
  }
  return (
    <>
      <PageTitle
        title={agent ? "Agent OTC" : t("Private quotes", "私下报价")}
        description={
          agent
            ? t(
                "An OTC desk gated by the Binance .ai Agent ID registry on BSC.",
                "通过 BSC 上的币安 .ai Agent ID 注册表限制双方资格的 OTC 入口。",
              )
            : t(
                "Agree on a price directly. Settle wallet to wallet without placing an AMM market sell.",
                "双方直接商定价格，钱包之间交割，无需向 AMM 提交市价卖单。",
              )
        }
        aside={
          agent ? (
            <span className="identity-state">
              <ShieldCheck size={19} />
              {!account
                ? t("Connect to check identity", "连接后检查身份")
                : eligible === null
                  ? t("Reading identity…", "正在读取身份…")
                  : eligible
                    ? t("Agent ID verified", "已验证 Agent ID")
                    : t("Agent ID required", "需要 Agent ID")}
            </span>
          ) : undefined
        }
      />
      <div className="trade-layout">
        <section>
          <div className="trade-controls">
            <div className="segmented">
              {[
                ["create", "Create quote", "创建报价"],
                ["take", "Take quote", "接受报价"],
                ["cancel", "Cancel", "取消"],
              ].map(([v, en, cn]) => (
                <button
                  key={v}
                  onClick={() => setTab(v)}
                  className={tab === v ? "selected" : ""}
                >
                  {t(en, cn)}
                </button>
              ))}
            </div>
            <span>BSC</span>
          </div>
          {!d && (
            <p className="note">
              {t(
                "Dark settlement is not deployed on this network yet.",
                "Dark 成交合约尚未在此网络部署。",
              )}
            </p>
          )}
          {tab === "create" && (
            <>
              <h2>{t("YOUR PRICE. YOUR TERMS.", "你的价格。你的条款。")}</h2>
              <label>
                {t("Token to sell", "出售的代币")}
                <input
                  value={sell}
                  onChange={(e) => {
                    setSell(e.target.value);
                    setPacket("");
                  }}
                  placeholder="0x…"
                />
              </label>
              <label>
                {t("Amount to sell", "出售数量")}
                <input
                  value={sellAmount}
                  onChange={(e) => {
                    setSellAmount(e.target.value);
                    setPacket("");
                  }}
                  placeholder="0.0"
                />
              </label>
              <label>
                {t("Payment token (ERC20)", "支付代币（ERC20）")}
                <input
                  value={buy}
                  onChange={(e) => {
                    setBuy(e.target.value);
                    setPacket("");
                  }}
                  placeholder="0x…"
                />
              </label>
              <label>
                {t("Amount paid to you", "你收到的数量")}
                <input
                  value={buyAmount}
                  onChange={(e) => {
                    setBuyAmount(e.target.value);
                    setPacket("");
                  }}
                  placeholder="0.0"
                />
              </label>
              <div className="field-row">
                <label>
                  {t("Counterparty (optional)", "指定对手方（可选）")}
                  <input
                    value={counterparty}
                    onChange={(e) => {
                      setCounterparty(e.target.value);
                      setPacket("");
                    }}
                    placeholder={t(
                      "Blank = any eligible taker",
                      "留空表示任意合格买方",
                    )}
                  />
                </label>
                <label>
                  {t("Valid for (hours)", "有效期（小时）")}
                  <input
                    value={hours}
                    onChange={(e) => {
                      setHours(e.target.value);
                      setPacket("");
                    }}
                  />
                </label>
              </div>
              <p className="note">
                {t(
                  "The taker pays 0.30% on top of your quoted amount. The payment token must transfer its full amount. Sale tokens may have transfer tax; the taker sets a minimum receipt.",
                  "买方在报价金额外另付 0.30% 手续费。支付代币必须足额到账；出售代币可有转账税，由买方设置最低到账量。",
                )}
              </p>
              <div className="form-actions">
                <button
                  className="button"
                  disabled={busy || working || !d}
                  onClick={() => void approveSell()}
                >
                  {t("Approve exact sale amount", "授权精确出售数量")}
                </button>
                <button
                  className="button primary"
                  disabled={
                    busy || working || !d || (agent && eligible !== true)
                  }
                  onClick={() => void signQuote()}
                >
                  {working
                    ? t("Preparing…", "准备中…")
                    : t("Sign private quote", "签署私下报价")}
                  <ArrowRight size={15} />
                </button>
              </div>
              {packet && (
                <div className="quote-export">
                  <h3>{t("Share with your counterparty", "分享给对手方")}</h3>
                  <textarea readOnly value={packet} aria-label="Signed quote" />
                  <div>
                    <button
                      className="button"
                      onClick={async () => {
                        await navigator.clipboard.writeText(packet);
                        setCopied(true);
                      }}
                    >
                      {copied ? <Check size={14} /> : <Copy size={14} />}{" "}
                      {t("Copy quote", "复制报价")}
                    </button>
                    <button className="button" onClick={download}>
                      <Download size={14} />
                      {t("Download JSON", "下载 JSON")}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          {tab === "take" && (
            <>
              <h2>{t("REVIEW. THEN SETTLE.", "核对，再成交。")}</h2>
              <label>
                {t("Paste the signed quote", "粘贴签名报价")}
                <textarea
                  className="json-input"
                  value={packet}
                  onChange={(e) => {
                    setPacket(e.target.value);
                    setImported(null);
                    setTerms(null);
                  }}
                  placeholder="{ … }"
                />
              </label>
              <button
                className="button"
                disabled={working || busy}
                onClick={() => void inspect()}
              >
                {t("Decode & check quote", "解析并检查报价")}
              </button>
              {imported && terms && (
                <div className="quote-review">
                  <dl>
                    <div>
                      <dt>{t("You receive", "你将收到")}</dt>
                      <dd>
                        {formatUnits(
                          imported.order.sellAmount,
                          terms.s.decimals,
                        )}{" "}
                        {terms.s.symbol}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("You pay", "你支付")}</dt>
                      <dd>
                        {formatUnits(
                          imported.order.buyAmount,
                          terms.b.decimals,
                        )}{" "}
                        {terms.b.symbol}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("Additional fee", "额外手续费")}</dt>
                      <dd>
                        {formatUnits(terms.fee, terms.b.decimals)}{" "}
                        {terms.b.symbol}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("Expires", "截止时间")}</dt>
                      <dd>
                        {new Date(
                          imported.order.expiry * 1000,
                        ).toLocaleString()}
                      </dd>
                    </div>
                    <div>
                      <dt>Agent ID</dt>
                      <dd>
                        {imported.order.agentOnly
                          ? t("Both participants required", "双方必须持有")
                          : t("Not required", "不要求")}
                      </dd>
                    </div>
                  </dl>
                  <label>
                    {t("Seller", "卖方")}
                    <CopyText value={imported.order.maker} />
                  </label>
                  <label>
                    {t("Sale token", "出售代币")}
                    <CopyText value={imported.order.sellToken} />
                  </label>
                  <label>
                    {t("Payment token", "支付代币")}
                    <CopyText value={imported.order.buyToken} />
                  </label>
                  <label>
                    {t("Minimum amount received", "最低到账量")} (
                    {terms.s.symbol})
                    <input
                      value={minimum}
                      onChange={(e) => setMinimum(e.target.value)}
                    />
                  </label>
                  <div className="form-actions">
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => void approveBuy()}
                    >
                      {t("Approve exact payment", "授权精确付款")}
                    </button>
                    <button
                      className="button primary"
                      disabled={busy}
                      onClick={() => void settle()}
                    >
                      {t("Settle in my wallet", "在我的钱包中成交")}
                      <ArrowRight size={15} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          {tab === "cancel" && (
            <>
              <h2>{t("CANCEL A QUOTE.", "取消一个报价。")}</h2>
              <p>
                {t(
                  "Cancelling marks the maker’s nonce as used onchain. Only your own quotes are affected.",
                  "取消操作会在链上作废你自己的报价 nonce，不会影响其他人的报价。",
                )}
              </p>
              <label>
                Nonce
                <input
                  value={nonce}
                  onChange={(e) => setNonce(e.target.value)}
                  placeholder={t("From the signed quote", "从已签名报价中取得")}
                />
              </label>
              <button
                className="button primary"
                disabled={busy || !d}
                onClick={() => void cancel()}
              >
                {t("Cancel onchain", "链上取消")}
              </button>
            </>
          )}
        </section>
        <aside className="reading-aside">
          <FlowDiagram kind={agent ? "agent" : "otc"} />
          <LockKeyhole size={30} />
          <h3>
            {t(
              "Private negotiation. Public settlement.",
              "私下协商，链上交割。",
            )}
          </h3>
          <p>
            {t(
              "Dark does not publish an order book. Quotes are signed on your device and shared by you. A filled quote reveals the trade onchain.",
              "Dark 不发布公开订单簿。报价在你的设备签名，由你决定分享对象；成交后交易信息在链上公开。",
            )}
          </p>
          <p>
            {t(
              "This is not anonymous execution or a guarantee against price impact. Your agreement may affect market expectations.",
              "这不是匿名交易，也不保证完全没有市场影响，交易双方的行为仍可能影响市场。",
            )}
          </p>
          {agent && (
            <>
              <h3>
                {t("Identity enforced by the contract", "身份在合约中执行")}
              </h3>
              <p>
                {t(
                  "Both maker and taker must hold the configured Binance Agent ID NFT when the quote settles. A website login cannot replace that check.",
                  "成交时卖方和买方都必须持有指定币安 Agent ID NFT，网页登录不能代替此检查。",
                )}
              </p>
              <a
                href="https://web3.binance.com/agent-id"
                target="_blank"
                rel="noreferrer"
              >
                {t("Official Agent ID entry", "官方 Agent ID 入口")}
                <ArrowRight size={14} />
              </a>
            </>
          )}
          <Link to="/app/contracts">
            {t("Inspect settlement source", "查看成交合约源码")}
            <ArrowRight size={14} />
          </Link>
        </aside>
      </div>
    </>
  );
}
