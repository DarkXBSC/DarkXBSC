import GivingNominations from "../components/GivingNominations";
import SquareProof from "../components/SquareProof";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import {
  formatUnits,
  getAddress,
  Interface,
  isAddress,
  ZeroAddress,
} from "ethers";
import { AudioLines, ArrowRight, RefreshCw, Wallet } from "lucide-react";
import { useApp } from "../lib/context";
import { abi, chainInfo, flapFor, Contract, erc20, rpc, units, errorCode } from "../lib/chain";
import { GIFT_FACTORY } from "../lib/tax-route";
import { CopyText } from "../components/Frame";

type Flow = {
  disclosure?: {
    visibility: "private" | "public";
    purpose: string;
    profile?: string;
  };
  kind: "xmoney" | "gift" | "reserve" | "merchant" | "direct" | "external";
  address: string;
  block: number;
  received?: string;
  pons?: { credited:string;claimed:string;available:string;stage:string;lastBaseHash?:string };
  conversion?: {
    symbol: string;
    earned: string;
    remaining: string;
    stage: string;
    last?: {
      stage: string;
      hash: string | null;
      actual: string | null;
      deposit: string | null;
    } | null;
  };
  paid?: string;
  balance?: string;
  symbol?: string;
  decimals?: number;
  raw?: bigint;
  handle?: string;
  target?: string;
  deadline?: number;
  holderDividends?: boolean;
  creator?: string;
  paused?: boolean;
  status?: string;
  issue?: string;
  token?: string;
};
export default function Impact() {
  const app = useApp(),
    { config, account, t } = app,
    [params, setParams] = useSearchParams();
  const chain = params.get("chain") === "robinhood" ? "robinhood" : params.get("chain") === "base" ? "base" : "bsc";
  const chainLabel = chain === "robinhood" ? "Robinhood" : chain === "base" ? "Base" : "BSC";
  const stableSymbol = chain === "bsc" ? "USDT" : "USDC";
  const { hash } = useLocation();
  const panel =
    params.get("view") === "nominations"
      ? "nominations"
      : hash === "#square-proof" || params.get("view") === "channels"
        ? "channels"
        : params.has("token") || params.get("view") === "track"
          ? "track"
          : "home";
  const [input, setInput] = useState(params.get("token") || ""),
    [tx, setTx] = useState(params.get("tx") || ""),
    [view, setView] = useState<Flow | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [amount, setAmount] = useState(""),
    [release, setRelease] = useState(""),
    [enabled, setEnabled] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    let alive = true;
    fetch("/api/giving/capabilities")
      .then((r) => r.json())
      .then((r) => {
        if (alive) setEnabled(r.uid === true);
      })
      .catch(() => {});
    return () => {
      alive = false;
      seq.current++;
    };
  }, []);
  const linkedToken = params.get("token") || "",
    linkedTx = params.get("tx") || "";
  useEffect(() => {
    if (panel !== "track") return;
    setInput(linkedToken);
    setTx(linkedTx);
    reset();
    if (config && isAddress(linkedToken)) void inspect(linkedToken, linkedTx);
  }, [config, panel, linkedToken, linkedTx, chain]);
  function reset() {
    seq.current++;
    setView(null);
    setError("");
    setAmount("");
    setRelease("");
    setLoading(false);
  }
  async function inspect(target = input, hashInput = tx) {
    const n = ++seq.current;
    setLoading(true);
    setError("");
    setView(null);
    setAmount("");
    try {
      const token = getAddress(target.trim());
      if (!config || token === ZeroAddress) throw Error();
      const p = rpc(chain),
        block = await p.getBlockNumber(),
        at = { blockTag: block };
      if(chain==="robinhood") {
        const response=await fetch("/api/giving/x/status?chainId=4663&address="+token);
        if(!response.ok) throw Error();
        const x=await response.json();
        if(x.chainId!==4663 || !x.pons || x.rail!=="xmoney-tax")throw Error();
        if(hashInput.trim()){
          const receipt=await p.getTransactionReceipt(hashInput.trim());
          const iface=new Interface(await abi("PonsFactoryV2"));
          if(!receipt || receipt.status!==1 || await receipt.confirmations()<2 || !receipt.logs.some(log=>{
            if(getAddress(log.address)!==getAddress(config.protocols.pons.factory)) return false;
            const event=iface.parseLog(log);return event?.name==="TokenLaunched" && event.args.token===getAddress(x.token);
          })) throw Error();
        }
        if(n===seq.current)setView({kind:"xmoney",address:x.address,block:x.lastBlock,disclosure:x.disclosure,received:x.received,paid:x.paid,status:x.stage,issue:x.issue,pons:x.pons});
        return;
      }
      const portal = new Contract(
        flapFor(config, chain).vaultPortal,
        await abi("IVaultPortal"),
        p,
      );
      const [found, info] = await portal.tryGetVault(token, at);
      let result: Flow;
      if (
        found &&
        info.vaultFactory.toLowerCase() === GIFT_FACTORY.toLowerCase()
      ) {
        const v = new Contract(
          info.vault,
          [
            "function state() view returns(uint8)",
            "function xHandle() view returns(string)",
            "function streamingTarget() view returns(address)",
            "function createdAt() view returns(uint256)",
            "function timeoutPeriod() view returns(uint256)",
            "function taxToken() view returns(address)",
            "function streamedAmount(address) view returns(uint256)",
          ],
          p,
        );
        const [
          handle,
          target,
          created,
          window,
          balance,
          bound,
          state,
          observedBlock,
        ] = await Promise.all([
          v.xHandle(at),
          v.streamingTarget(at),
          v.createdAt(at),
          v.timeoutPeriod(at),
          p.getBalance(info.vault, block),
          v.taxToken(at),
          v.state(at),
          p.getBlock(block),
        ]);
        if (getAddress(bound) !== token) throw Error();
        result = {
          kind: "gift",
          address: info.vault,
          token,
          block,
          handle,
          target,
          deadline: Number(created + window) * 1000,
          holderDividends:
            Number(state) === 2 ||
            (target === ZeroAddress &&
              !!observedBlock &&
              observedBlock.timestamp >= Number(created + window)),
          balance: formatUnits(balance, 18),
          symbol: "BNB",
          paid:
            target !== ZeroAddress
              ? formatUnits(await v.streamedAmount(target, at), 18)
              : undefined,
        };
      } else if (
        found &&
        [
          config.chains.bsc.contracts.reserveFactory,
          ...(config.chains.bsc.history?.reserveFactory ?? []),
        ].some(
          (factory) =>
            factory.address.toLowerCase() === info.vaultFactory.toLowerCase(),
        )
      ) {
        const v = new Contract(info.vault, await abi("TigerReserve"), p);
        const [quote, creator, paused, bound] = await Promise.all([
          v.quoteToken(at),
          v.dev(at),
          v.paused(at),
          v.taxToken(at),
        ]);
        if (getAddress(bound) !== token) throw Error();
        let symbol = "BNB",
          decimals = 18,
          raw: bigint;
        if (quote === ZeroAddress) raw = await p.getBalance(info.vault, block);
        else {
          const erc = new Contract(quote, erc20, p);
          const [s, d, b] = await Promise.all([
            erc.symbol(at),
            erc.decimals(at),
            erc.balanceOf(info.vault, at),
          ]);
          symbol = s;
          decimals = Number(d);
          raw = b;
        }
        result = {
          kind: "reserve",
          address: info.vault,
          token,
          block,
          creator,
          paused,
          symbol,
          decimals,
          raw,
          balance: formatUnits(raw, decimals),
        };
      } else {
        let collection = token;
        if (hashInput.trim()) {
          if (!/^0x[0-9a-f]{64}$/i.test(hashInput.trim())) throw Error();
          const [transaction, receipt] = await Promise.all([
            p.getTransaction(hashInput.trim()),
            p.getTransactionReceipt(hashInput.trim()),
          ]);
          if (
            !transaction ||
            !receipt ||
            receipt.status !== 1 ||
            (await receipt.confirmations()) < 2 ||
            transaction.to?.toLowerCase() !==
              flapFor(config, chain).portal.toLowerCase()
          )
            throw Error();
          const iface = new Interface(await abi("IPortal")),
            decoded = iface.parseTransaction({ data: transaction.data });
          if (
            decoded?.name !== "newTokenV6" ||
            !receipt.logs.some((l) => {
              if (
                l.address.toLowerCase() !==
                flapFor(config, chain).portal.toLowerCase()
              )
                return false;
              try {
                const e = iface.parseLog(l);
                return (
                  e?.name === "TokenCreated" &&
                  getAddress(e.args.token) === token
                );
              } catch {
                return false;
              }
            })
          )
            throw Error();
          collection = decoded.args[0].beneficiary;
        }
        const xResult = await fetch(
          "/api/giving/x/status?chainId=" + chainInfo[chain].id + "&address=" + collection,
        );
        if (xResult.ok) {
          const x = await xResult.json();
          if (
            x.rail !== "xmoney-tax" || x.chainId !== chainInfo[chain].id ||
            (hashInput.trim() &&
              (getAddress(x.address) !== getAddress(collection) ||
                getAddress(x.token) !== token))
          )
            throw Error();
          if (n === seq.current)
            setView({
              kind: "xmoney",
              disclosure: x.disclosure,
              address: x.address,
              block: x.lastBlock,
              received: x.received,
              conversion: x.conversion,
              paid: x.paid,
              status: x.stage,
              issue: x.issue,
            });
          return;
        }
        if (![404, 503].includes(xResult.status)) throw Error();
        const res = await fetch("/api/giving/status?address=" + collection);
        if (res.ok) {
          const d = await res.json();
          result = {
            kind: "merchant",
            address: collection,
            block: d.lastBlock,
            received: d.received,
            paid: d.paid,
            symbol: "USDT",
            status: d.pending || "",
          };
        } else if (res.status === 404 || res.status === 503)
          result = {
            kind: hashInput.trim() ? "direct" : "external",
            address: collection,
            block,
          };
        else throw Error();
      }
      if (n === seq.current) setView(result);
    } catch {
      if (n === seq.current)
        setError(
          t(
            `Could not verify this ${chainLabel} route. Check the address, creation hash and RPC connection.`,
            `无法核验这条 ${chainLabel} 路径。请检查地址、创建哈希及 RPC 连接。`,
          ),
        );
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }
  async function withdraw() {
    if (!view || view.kind !== "reserve" || !account || view.paused) return;
    try {
      const value = units(amount, view.decimals!),
        target = getAddress(account);
      if (value <= 0n || value > view.raw!) throw Error("INVALID_AMOUNT");
      const iface = new Interface(await abi("TigerReserve"));
      const receipt = await app.transact(
        "bsc",
        {
          to: view.address,
          data: iface.encodeFunctionData("withdraw", [value, target]),
        },
        "Withdraw giving reserve",
      );
      const matches = receipt.logs.some((l) => {
        if (l.address.toLowerCase() !== view.address.toLowerCase())
          return false;
        try {
          const e = iface.parseLog(l);
          return (
            e?.name === "Withdrawn" &&
            e.args.amount === value &&
            getAddress(e.args.recipient) === target
          );
        } catch {
          return false;
        }
      });
      if (!matches) throw Error("RECEIPT_MISMATCH");
      setRelease(receipt.hash);
      await inspect();
    } catch (e) {
      app.setMessage(errorCode(e));
    }
  }
  return (
    <>
      {panel === "home" && (
        <section className="bags-giving-home">
          <p className="giving-kinds">BSC + Base · Flap · X Money</p>
          <h1>
            <span>{t("TRACK YOUR", "追踪交易税")}</span>
            <span>{t("TRADING FEE", "公益付款")}</span>
            <span>{t("PAYOUTS.", "与回执")}</span>
          </h1>
          <p className="giving-intro">
            {t(
              "Follow a token’s trading fees from collection to payout. Look up the token or its collection address to check the receipts.",
              "输入代币或归集地址，查看已确认的交易税，以及受益人已收到的款项和付款凭证。",
            )}
          </p>
          <Link
            className="bags-action giving-primary"
            to="/app/impact?view=track"
          >
            {t("Track a payout", "核对付款")}
          </Link>
          <Link className="giving-secondary" to="/app/impact?view=channels">
            {t("Choose a tax beneficiary", "选择税收受益人")}
          </Link>
          <Link className="giving-secondary" to="/app/impact?view=nominations">
            {t("Community nominations", "社区公益提名")}
          </Link>
          <Link className="giving-secondary" to="/app/railgun">{t("Shield funds on BSC", "BSC 隐私存入")}</Link>
          <p className="giving-privacy">
            {t(
              "Onchain tax receipts · Verified payout records",
              "链上税收回执 · 可核对的付款记录",
            )}
          </p>
        </section>
      )}
      {panel !== "home" && (
        <div className="bags-giving-task">
          <Link className="giving-back" to="/app/impact">
            {t("Back to giving", "返回税收公益")}
          </Link>
          {panel === "nominations" && <GivingNominations />}
          {panel === "channels" && (
            <section className="giving-routes">
              <h2>{t("Choose a tax beneficiary", "选择税收受益人")}</h2>
              <p>
                {t(
                  "Choose who receives trading fees when you create the token.",
                  "发币时指定受益人，随后交易产生的税收按选定渠道分配。",
                )}
              </p>
              <div className="giving-route">
                <span className="social-square">X</span>
                <div>
                  <h3>X Money</h3>
                  <p>
                    {t(
                      "Choose a private X beneficiary on BSC or Base. BNB taxes convert to USDT and bridge to Base; ETH taxes convert locally to USDC. Peer matches the USD payer.",
                      "在 BSC 或 Base 发行时指定私密 X 受益人。BNB 税收兑换 USDT 后跨链，ETH 税收在 Base 兑换 USDC，再由 Peer 匹配美元付款人。",
                    )}
                  </p>
                  <Link to="/app/launch?route=x">
                    {t("Launch for an X account", "为 X 用户发币")}
                    <ArrowRight size={14} />
                  </Link>
                </div>
              </div>
              <div className="giving-route">
                <span className="social-square">
                  <AudioLines size={23} />
                </span>
                <div>
                  <h3>
                    {t("Square post or Binance UID", "广场帖子或币安 UID")}
                  </h3>
                  <p>
                    {t(
                      "Enter the recipient’s exchange UID or paste an ordinary Square post. Automatic USDT payments require a verified recipient and a funded Binance Pay merchant.",
                      "填对方的交易所 UID，或粘贴一条普通广场原帖。确认作者对应的收款账户后，有付款权限及余额的币安 Pay 商户可自动发放 USDT。",
                    )}
                  </p>
                  <small>
                    {enabled
                      ? t("Merchant configured", "已配置商户")
                      : t("Merchant setup required", "等待接入币安 Pay 商户")}
                  </small>
                  <Link to="/app/launch?route=square">
                    {t("Check a recipient", "检查收款人")}
                    <ArrowRight size={14} />
                  </Link>
                </div>
              </div>
              <div className="giving-route">
                <span className="social-square">
                  <Wallet size={24} />
                </span>
                <div>
                  <h3>
                    {t("Optional BSC wallet settlement", "可选的 BSC 钱包收款")}
                  </h3>
                  <p>
                    {t(
                      "Authors who prefer onchain fees can use a signed wallet declaration.",
                      "希望在链上收取税收的作者也可使用已签名的收款钱包。",
                    )}
                  </p>
                  <Link to="/app/launch?route=square-wallet">
                    {t("Use a signed wallet", "使用签名钱包")}
                    <ArrowRight size={14} />
                  </Link>
                </div>
              </div>
              <SquareProof />
              <details className="giving-resources">
                <summary>{t("Beneficiary resources", "受益人资料")}</summary>
                <a
                  href="https://www.binance.com/en/support/faq/detail/9c92d94e63ec47db8a82f1742322ad5d"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t(
                    "How to tip an eligible post on Square",
                    "如何在广场给符合条件的原帖打赏",
                  )}
                </a>
                <a href="/private-giving.md" download>
                  {t("Download the beneficiary guide", "下载受益人操作指南")}
                </a>
              </details>
              <p className="help">
                {t(
                  "Dark encrypts new X recipient records locally. Collection addresses, amounts and transfers are public. X and payment providers handle the offchain identity.",
                  "新发行的 X 受益人资料在本地加密。归集地址、金额和链上转账公开，X 和支付服务参与方会处理收款身份。",
                )}
              </p>
            </section>
          )}
          {panel === "track" && (
            <section className="desk-box giving-tracker">
              <div className="operation-heading">
                <h2>{t("Track real distributions", "核对真实分配")}</h2>
                <AudioLines size={20} />
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void inspect();
                }}
              >
                <label>{t("Network", "网络")}<select value={chain} onChange={e => { reset(); const next = new URLSearchParams(params); next.set("chain", e.target.value); next.delete("token"); next.delete("tx"); setInput(""); setTx(""); setParams(next); }}><option value="bsc">BSC</option><option value="base">Base</option><option value="robinhood">Robinhood</option></select></label>
                <label>
                  {t("Flap token or collection address", "Flap 代币或归集地址")}
                  <input
                    value={input}
                    required
                    placeholder="0x…"
                    onChange={(e) => {
                      reset();
                      setInput(e.target.value);
                      setTx("");
                    }}
                  />
                </label>
                <details>
                  <summary>{t("Use a launch receipt", "使用发行回执")}</summary>
                  <label>
                    {t("Creation transaction hash", "创建交易哈希")}
                    <input
                      value={tx}
                      placeholder="0x…"
                      onChange={(e) => {
                        reset();
                        setTx(e.target.value);
                      }}
                    />
                  </label>
                </details>
                <button
                  className="button primary"
                  disabled={loading || !config || !input.trim()}
                >
                  <RefreshCw size={15} />
                  {loading
                    ? t("Reading…", "读取中…")
                    : t("Check onchain", "在链上核对")}
                </button>
              </form>
              {error && <p role="alert">{error}</p>}
              {view && (
                <div className="flow-evidence" role="status">
                  <h3>
                    {view.kind === "xmoney"
                      ? "X Money"
                      : view.kind === "gift"
                        ? "Flap Gift Vault"
                        : view.kind === "reserve"
                          ? t("Dark reserve", "Dark 储备金库")
                          : view.kind === "merchant"
                            ? "Binance Pay"
                            : view.kind === "direct"
                              ? t("Beneficiary at launch", "发行时设定的受益人")
                              : t(
                                  "No supported distribution found",
                                  "未找到可核验的分配路径",
                                )}
                  </h3>
                  <p>{chainLabel} · #{view.block}</p>
                  <CopyText value={view.address} />
                  {view.kind === "xmoney" && (
                    <>
                      <p>
                        {view.disclosure?.visibility === "public" &&
                        view.disclosure.profile ? (
                          <a
                            href={view.disclosure.profile}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t("Public X beneficiary", "公开 X 受益人")} · @
                            {view.disclosure.profile.split("/").pop()}
                          </a>
                        ) : (
                          t(
                            "Private beneficiary · account processed by the settlement service",
                            "私密受益人 · 账号由结算服务处理",
                          )
                        )}
                      </p>
                      {view.disclosure?.purpose && (
                        <p>{view.disclosure.purpose}</p>
                      )}
                      <p>
                        {view.pons ? t("Received on Base","Base 实际到账") : view.conversion
                          ? t("Confirmed conversion proceeds", "已核验兑换所得")
                          : t("Confirmed Flap tax", "已确认 Flap 税收")}{" "}
                        {view.received} {stableSymbol}
                      </p>
                      {view.pons && <div>
                        <p>{t("Credited by Pons", "Pons 已归集")} {view.pons.credited} ETH · {t("Claimed by Dark","Dark 已领取")} {view.pons.claimed} ETH</p>
                        <p>{t("Available for bridging","可跨链余额")} {view.pons.available} ETH</p>
                        <p>{view.pons.stage==="awaiting-operator" ? t("Waiting for the Pons operator to convert pool fees","交易池费用等待 Pons 操作方兑换") : view.pons.stage==="awaiting-sweep" ? t("Waiting for Pons to sweep fees","等待 Pons 归集费用") : view.pons.stage==="sweep" ? t("Sweeping creator fees","正在归集创建者费用") : view.pons.stage==="claim" ? t("Claiming ETH","正在领取 ETH") : ["deposit","bridge"].includes(view.pons.stage) ? t("Bridging to Base","正在跨链至 Base") : t("Collecting for the next batch","等待下一批结算")}</p>
                        {view.pons.lastBaseHash && <a href={chainInfo.base.explorer+"/tx/"+view.pons.lastBaseHash} target="_blank" rel="noreferrer">{t("Base USDC receipt","Base USDC 到账回执")}</a>}
                      </div>}
                      {view.conversion && (
                        <div>
                          <p>
                            {t("Confirmed pool tax", "已确认底池税收")}{" "}
                            {view.conversion.earned} {view.conversion.symbol}
                          </p>
                          <p>
                            {t("Awaiting conversion", "待兑换")}{" "}
                            {view.conversion.remaining} {view.conversion.symbol}
                            {view.conversion.stage === "converting" &&
                              t(" · order in progress", " · 订单处理中")}
                          </p>
                          {view.conversion.last?.stage === "complete" &&
                            view.conversion.last.hash && (
                              <a
                                href={
                                  chainInfo[chain].explorer + "/tx/" +
                                  view.conversion.last.hash
                                }
                                target="_blank"
                                rel="noreferrer"
                              >
                                {t("Last conversion receipt", "上次兑换回执")}
                              </a>
                            )}
                          {view.conversion.last?.deposit && (
                            <a
                              href={
                                chainInfo[chain].explorer + "/tx/" +
                                view.conversion.last.deposit
                              }
                              target="_blank"
                              rel="noreferrer"
                            >
                              {t(` ${stableSymbol} transfer receipt`, ` ${stableSymbol} 到账回执`)}
                            </a>
                          )}
                        </div>
                      )}
                      <p>
                        {t("Verified X Money payments", "X Money 有凭证的付款")}{" "}
                        {view.paid} USD
                      </p>
                      <p>
                        {
                          (
                            {
                              collecting: t("Collecting tax", "归集税收中"),
                              "source-deposit": t(
                                "Confirming BSC deposit",
                                "核对 BSC 入金",
                              ),
                              bridge: t(
                                "Checking the bridge transfer",
                                "核对跨链到账",
                              ),
                              base: t(
                                "Preparing the X Money order",
                                "准备 X Money 订单",
                              ),
                              approve: t(
                                "Confirming USDC approval",
                                "核对 USDC 授权",
                              ),
                              deposit: t(
                                "Confirming the Peer deposit",
                                "核对 Peer 入金",
                              ),
                              matching: t(
                                "Waiting for payment proof",
                                "等待付款证明",
                              ),
                              paid: t("Payment verified", "付款已核验"),
                            } as Record<string, string>
                          )[view.status || ""]
                        }
                      </p>
                      {view.issue && (
                        <p>
                          {[
                            "X_CONVERSION_REVIEW",
                            "X_POOL_MISMATCH",
                            "X_CONVERSION_PRICE",
                          ].includes(view.issue)
                            ? view.issue === "X_CONVERSION_PRICE"
                              ? t(
                                  "Waiting for a quote above the approved minimum.",
                                  "正在等待达到运营方最低到账要求的报价。",
                                )
                              : t(
                                  "Conversion evidence requires operator review.",
                                  "兑换凭证需要运营方核对。",
                                )
                            : view.issue === "X_GAS_FUNDING"
                              ? t(
                                  "Waiting for the deployment wallet’s gas transfer to confirm.",
                                  "正在等待部署钱包的补 Gas 交易确认。",
                                )
                              : view.issue === "X_GAS_SPONSOR_LOW"
                                ? t(
                                    "The deployment wallet needs more gas. Settlement retries automatically.",
                                    "部署钱包的 Gas 余额不足，补足后自动继续。",
                                  )
                                : view.issue === "X_GAS_PRICE_HIGH"
                                  ? t(
                                      "Network fees exceed the configured gas limit. Retrying automatically.",
                                      "当前网络费用超过补 Gas 保护上限，服务会自动重试。",
                                    )
                                  : view.issue === "X_GAS_REVIEW"
                                    ? t(
                                        "The operator is needed to reconcile a previous gas transfer.",
                                        "前一笔补 Gas 交易需要运营方核对。",
                                      )
                                    : view.issue === "X_GAS_REQUIRED"
                                      ? t(
                                          "Operator gas funding required on BSC and Base.",
                                          "结算地址等待运营方补充 BSC 和 Base Gas。",
                                        )
                                      : t(
                                          "Settlement is pending reconciliation.",
                                          "结算待核对。",
                                        )}
                        </p>
                      )}
                    </>
                  )}
                  {view.kind === "gift" && (
                    <>
                      <p>
                        @{view.handle} ·{" "}
                        {view.target !== ZeroAddress
                          ? t("Streaming", "自动转付中")
                          : view.holderDividends
                            ? t(
                                "First proof expired · holder dividends",
                                "首次证明已超时 · 持币者分红",
                              )
                            : t(
                                "Awaiting first X proof",
                                "等待首次 X 归属证明",
                              )}
                      </p>
                      <p>
                        {t("Vault balance", "金库余额")} {view.balance} BNB
                      </p>
                      {view.target !== ZeroAddress ? (
                        <>
                          <CopyText value={view.target!} />
                          <p>
                            {t("Streamed to current target", "已转至当前目标")}{" "}
                            {view.paid} BNB
                          </p>
                        </>
                      ) : (
                        <p>
                          {t("Initial proof deadline", "首次证明期限")}{" "}
                          {new Date(view.deadline!).toLocaleString()}
                        </p>
                      )}
                      <a
                        className="button"
                        href={"https://flap.sh/bnb/" + view.token + "/taxinfo"}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t("Manage gift on Flap", "在 Flap 管理税收赠与")}
                      </a>
                    </>
                  )}
                  {view.kind === "direct" && (
                    <>
                      <p>
                        {t(
                          "Verified in the Flap creation transaction. Check the beneficiary’s wallet history for individual receipts.",
                          "已核验 Flap 创建交易。单笔到账可在受益人地址的流水中查阅。",
                        )}
                      </p>
                      <a
                        className="button"
                        href={chainInfo[chain].explorer + "/address/" + view.address}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t("View wallet activity", "查看钱包流水")}
                      </a>
                    </>
                  )}
                  {view.kind === "merchant" && (
                    <>
                      <p>
                        {t("Confirmed collections", "已确认归集")}{" "}
                        {view.received} {stableSymbol}
                      </p>
                      <p>
                        {t("Successful Binance payouts", "币安已确认付款")}{" "}
                        {view.paid} USDT
                      </p>
                      {view.status && (
                        <p>
                          {view.status === "failed"
                            ? t(
                                "Merchant reconciliation required",
                                "需商户核对失败订单",
                              )
                            : t(
                                "Awaiting merchant confirmation",
                                "等待商户回执",
                              )}
                        </p>
                      )}
                    </>
                  )}
                  {view.kind === "reserve" && (
                    <>
                      <p>
                        {t("Available", "可支取")} {view.balance} {view.symbol}
                      </p>
                      <p>
                        {t(
                          "Reserve withdrawals go to the connected controller wallet. Social distribution requires a separate payment.",
                          "储备拨款转入当前控制者钱包。向社交用户付款是下一笔独立操作。",
                        )}
                      </p>
                      <label>
                        {t("Withdrawal amount", "支取金额")} · {view.symbol}
                        <input
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          inputMode="decimal"
                        />
                      </label>
                      {account ? (
                        <button
                          className="button"
                          disabled={
                            app.busy ||
                            !amount ||
                            view.paused ||
                            ![
                              view.creator?.toLowerCase(),
                              "0x9e27098dcd8844bcc6287a557e0b4d09c86b8a4b",
                            ].includes(account.toLowerCase())
                          }
                          onClick={() => void withdraw()}
                        >
                          {t("Withdraw to my wallet", "支取至我的钱包")}
                        </button>
                      ) : (
                        <button
                          className="button"
                          onClick={() => void app.connect()}
                        >
                          {t("Connect controller wallet", "连接控制者钱包")}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
              {release && (
                <a
                  href={chainInfo[chain].explorer + "/tx/" + release}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("Confirmed withdrawal receipt", "已确认拨款回执")}
                </a>
              )}
            </section>
          )}
        </div>
      )}
    </>
  );
}
