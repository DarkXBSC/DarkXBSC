import Workspace from "./Workspace";
import LanguageSwitch from "./LanguageSwitch";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { motionEnabled } from "../lib/motion";
import { NextChapter, MotionToggle } from "./MotionDetails";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  X,
  Wallet,
  Check,
  Copy,
} from "lucide-react";
import { useApp } from "../lib/context";
import { short } from "../lib/chain";
export function CopyText({ value }: { value: string }) {
  const { t } = useApp();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="copy"
      title={done ? t("Copied", "已复制") : t("Copy address", "复制地址")}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
      <code>{value}</code>
    </button>
  );
}
export function OfficialTokenNotice() {
  const { t, config } = useApp();
  const token = config?.officialToken;
  if (!token) return null;
  return (
    <section className="token-notice official-token" aria-label={t("Official token", "官方代币")}>
      <b>{t(`Official token · ${token.name} (BSC)`, `官方代币 · ${token.name}（BSC）`)}</b>
      <CopyText value={token.address} />
      <a href={`${config.chains.bsc.explorer}/token/${token.address}`} target="_blank" rel="noreferrer">
        {t("View on BscScan", "在 BscScan 查看")}
      </a>
    </section>
  );
}
export function Header() {
  const { t, dark, toggleTheme, account, connect, disconnect } = useApp();
  const [open, setOpen] = useState(false),
    [menuMounted, setMenuMounted] = useState(false),
    [wallet, setWallet] = useState(false);
  useEffect(() => {
    if (open) {
      setMenuMounted(true);
      return;
    }
    const timer = setTimeout(() => setMenuMounted(false), 520);
    return () => clearTimeout(timer);
  }, [open]);
  const loc = useLocation(),
    menu = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setOpen(false);
    setWallet(false);
    window.scrollTo(0, 0);
  }, [loc.pathname]);
  useEffect(() => {
    const click = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setWallet(false);
        if (menu.current?.querySelector(".menu")) trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", click);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", click);
      document.removeEventListener("keydown", key);
    };
  }, []);
  return (
    <header className="site-header">
      <Link to="/" className="wordmark" aria-label="Dark home">
        <img src="/brand/dark-mark.png" alt="" />
        Dark
      </Link>
      <nav aria-label={t("Main navigation", "主导航")}>
        <NavLink to="/app/hire">{t("Hire an Agent", "招个 Agent")}</NavLink>
        <NavLink to="/app/explore">{t("Explore", "市场")}</NavLink>
        <NavLink to="/app/launch">{t("Launch", "发射")}</NavLink>
        <NavLink to="/app/rebalance">{t("Rebalance", "配平")}</NavLink>
        <NavLink to="/app/agent-otc">Agent OTC</NavLink>
        <div className="menu-wrap" ref={menu}>
          <button
            ref={trigger}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {t("More", "更多")} <ChevronDown size={12} />
          </button>
          {(open || menuMounted) && (
            <div className="menu" data-open={open} inert={!open}>
              {[
                ["/app/agent-pay", "Agent Pay · preview", "Agent Pay · 预览"],
                ["/app/otc", "Private quotes", "私下报价"],
                ["/app/contracts", "Contracts & source", "合约与源码"],
                ["/app/learn", "Handbook", "使用教材"],
                ["/app/activity", "Activity", "交易记录"],
              ].map(([to, en, cn]) => (
                <Link key={to} to={to}>
                  {t(en, cn)}
                  <ArrowRight size={14} />
                </Link>
              ))}
              <a
                href="https://x.com/Tiger_AgentID"
                target="_blank"
                rel="noreferrer"
              >
                X / @Tiger_AgentID
              </a>
            </div>
          )}
        </div>
        <LanguageSwitch />
        <button
          className="theme-button"
          onClick={() => {
            if (!motionEnabled() || !document.startViewTransition) {
              toggleTheme();
              return;
            }
            const transition = document.startViewTransition(() =>
              flushSync(toggleTheme),
            );
            transition.ready
              .then(() =>
                document.documentElement.animate(
                  [
                    { clipPath: "inset(0 100% 0 0)" },
                    { clipPath: "inset(0 0 0 0)" },
                  ],
                  {
                    duration: 900,
                    easing: "cubic-bezier(.16,1,.3,1)",
                    pseudoElement: "::view-transition-new(root)",
                  },
                ),
              )
              .catch(() => {});
          }}
          aria-label={t("Switch theme", "切换主题")}
        >
          <i className="theme-glyph" aria-hidden="true" />
          <span>{dark ? "DARK" : "LIGHT"}</span>
        </button>
        <div className="wallet-wrap">
          <button
            className="wallet-button"
            onClick={() => (account ? setWallet(!wallet) : void connect())}
          >
            <Wallet size={14} />
            {account ? short(account) : t("Connect", "连接钱包")}
          </button>
          {wallet && (
            <div className="wallet-popover">
              <CopyText value={account} />
              <button
                onClick={() => {
                  disconnect();
                  setWallet(false);
                }}
              >
                {t("Disconnect locally", "断开本地连接")}
              </button>
            </div>
          )}
        </div>
      </nav>
    </header>
  );
}
export function ScrollRail() {
  const rail = useRef<HTMLDivElement>(null),
    loc = useLocation();
  useEffect(() => {
    const root = rail.current!,
      label = root.querySelector("span")!,
      track = root.querySelector("div")!,
      marker = track.querySelector("i")!;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const range = document.documentElement.scrollHeight - innerHeight,
          value = range > 0 ? scrollY / range : 0;
        label.textContent = String(Math.round(value * 100)).padStart(3, "0");
        marker.style.top = `${value * 100}%`;
        const headings = [
          ...document.querySelectorAll<HTMLElement>(
            ".page-plane main h1,.page-plane main h2,.page-plane .next-page",
          ),
        ];
        track.querySelectorAll("b").forEach((el) => el.remove());
        headings.forEach((el) => {
          const y = el.getBoundingClientRect().top + scrollY,
            b = document.createElement("b");
          b.style.top = `${Math.min(100, Math.max(0, (y / Math.max(range, 1)) * 100))}%`;
          b.dataset.passed = String(scrollY + innerHeight * 0.35 >= y);
          track.append(b);
        });
      });
    };
    const ro = new ResizeObserver(update);
    ro.observe(document.body);
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    window.addEventListener("dark:route-ready", update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("dark:route-ready", update);
    };
  }, [loc.pathname]);
  return (
    <div ref={rail} className="scroll-rail" aria-hidden="true">
      <span>000</span>
      <div>
        <i />
      </div>
    </div>
  );
}
export function Footer() {
  const { t } = useApp();
  return (
    <footer>
      <span>© {new Date().getFullYear()} DARK</span>
      <div>
        <MotionToggle />
        <a href="https://x.com/DarkLBSC" target="_blank" rel="noreferrer">
          DarkLBSC
        </a>
        <Link to="/app/contracts">{t("SOURCE", "源码")}</Link>
        <Link to="/app/learn">{t("HANDBOOK", "教材")}</Link>
        <button
          onClick={() =>
            window.scrollTo({
              top: 0,
              behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                ? "instant"
                : "smooth",
            })
          }
        >
          {t("BACK TO TOP", "返回顶部")}
          <ArrowUp size={13} />
        </button>
      </div>
    </footer>
  );
}
const errors: Record<string, [string, string]> = {
  ZERO_TAX_UNAVAILABLE: [
    "Zero-tax launches are currently unavailable here. Use a nonzero tax configuration.",
    "此界面暂不开放零税发行，请使用非零税率配置。",
  ],
  INVALID_QUOTE_SIGNATURE: [
    "The quote signature does not match its maker. Request the original signed quote.",
    "签名与报价方不匹配，请索取原始签名报价。",
  ],
  QUOTE_COUNTERPARTY_MISMATCH: [
    "This quote does not allow the connected wallet to take it. Check its maker and taker addresses.",
    "该报价不允许当前钱包接单，请核对卖方和买方地址。",
  ],
  RECOVER_PREVIOUS_TRANSACTION: [
    "Resolve the previous wallet submission in Activity before sending another transaction.",
    "请先在交易记录中核对上一笔钱包提交，再进行新交易。",
  ],
  TRANSACTION_PENDING: [
    "A wallet transaction is in progress. Wait for its result.",
    "钱包交易正在处理中，请等待结果。",
  ],
  TRANSACTION_MISMATCH: [
    "This hash does not match the original request. Check the hash in your wallet.",
    "该哈希与原始请求不一致，请核对钱包中的哈希。",
  ],
  TRANSACTION_REVERTED: [
    "The transaction reverted onchain. The receipt is in Activity.",
    "交易已在链上回滚，请到交易记录查看回执。",
  ],
  RPC_UNAVAILABLE: [
    "The network could not be read. Retry shortly.",
    "暂时无法读取网络，请稍后重试。",
  ],
  PRIVATE_RECIPIENT_IN_PUBLIC_CONTENT: [
    "The private recipient appears in public project details. Remove the handle or choose public beneficiary mode.",
    "公开资料中包含私密受益人账号，请移除账号或选择公开受益人模式。",
  ],
  PRIVATE_NOMINATION_REQUIRED: [
    "Community nominations keep their beneficiary private.",
    "社区提名的受益人须保持私密。",
  ],
  INVALID_DISCLOSURE: [
    "Check the beneficiary privacy setting and public purpose.",
    "请核对受益人隐私设置与公开用途。",
  ],
  DESCRIPTION_TOO_LONG: [
    "The description and beneficiary disclosure must fit within 2,000 characters.",
    "项目描述与受益人公开资料合计须在 2,000 个字符以内。",
  ],
  LAUNCH_DETAILS_CHANGED: [
    "Details changed while preparing. Review and check the launch again.",
    "准备期间资料已变化，请重新核对并检查发行。",
  ],
  FEE_ESTIMATE_UNAVAILABLE: [
    "The network fee estimate is unavailable. Retry the check.",
    "暂时无法估算网络费用，请重新检查。",
  ],
  UPLOAD_IMAGE_FIRST: [
    "Upload a real token image and wait for its metadata before previewing.",
    "请先上传真实代币图片并取得 metadata，再预览发行。",
  ],
  UPLOAD_FAILED: [
    "Flap could not pin the image. Retry the upload; no token has been issued.",
    "Flap 未能保存图片，请重试上传；尚未发行代币。",
  ],
  METADATA_UNAVAILABLE: [
    "The image was uploaded, but its metadata is not ready. Retry Publish & check launch to read it again.",
    "图片已上传，但资料暂时无法读取。请再次点击“公开资料并检查发行”，重新读取已上传资料。",
  ],
  METADATA_IMAGE_MISSING: [
    "The metadata does not contain a valid image. Recheck the uploaded file.",
    "metadata 不包含有效图片地址，请核对上传文件。",
  ],
  INVALID_TOKEN_NAME: [
    "Use a nonempty name up to 64 UTF-8 bytes and a symbol up to 16 bytes.",
    "请填写名称（最多 64 字节）与代码（最多 16 字节）。",
  ],
  INVALID_TAX: [
    "Use a tax percentage from 0 to 100, with up to two decimal places. The protocol may impose a lower limit.",
    "税率需为 0–100 的百分数，最多两位小数；协议可能要求更低上限。",
  ],
  INVALID_TAX_DURATION: [
    "Tax duration must be 1–3650 whole days for a taxed token.",
    "税币的税收持续时间必须为 1–3650 的整数天数。",
  ],
  RESERVE_REQUIRES_TAX: [
    "A reserve requires a nonzero tax. Disable the reserve for a zero-tax launch.",
    "储备金库需要非零税率，零税发行请取消金库选项。",
  ],
  APPROVE_QUOTE_FIRST: [
    "Approve the exact first-buy amount before simulating again.",
    "请先授权精确首买金额，再重新模拟。",
  ],
  APPROVE_SELL_FIRST: [
    "Approve the exact sale amount before signing the quote.",
    "请先授权精确出售数量，再签署报价。",
  ],
  AGENT_ID_REQUIRED: [
    "Both participants need the configured Binance Agent ID when this quote settles.",
    "这类报价成交时，双方都必须持有指定币安 Agent ID。",
  ],
  QUOTE_FORMAT_INVALID: [
    "The quote is incomplete or invalid JSON. Paste the complete signed JSON shared by the maker.",
    "报价不完整或 JSON 格式错误，请粘贴卖方分享的完整签名 JSON。",
  ],
  QUOTE_DOMAIN_MISMATCH: [
    "This quote belongs to another network, contract or access type. Select the correct desk.",
    "报价的网络、合约或身份类型不匹配，请选择正确入口。",
  ],
  QUOTE_EXPIRED_OR_INVALID: [
    "The quote is invalid or expired. Ask the maker for a new signed quote.",
    "报价无效或已过期，请向卖方索取新的签名报价。",
  ],
  QUOTE_USED_OR_CANCELLED: [
    "This quote was already settled or cancelled. It cannot be reused.",
    "报价已成交或取消，不能重复使用。",
  ],
  INVALID_EXPIRY: [
    "Enter an expiry within the displayed limits, no more than 720 hours.",
    "请输入有效期限，最多 720 小时；库存锁定至少 10 分钟。",
  ],
  INVALID_NONCE: [
    "Copy the numeric nonce from the signed quote.",
    "请从签名报价中复制整数 nonce。",
  ],
  INVALID_HASH: [
    "Enter a complete transaction hash: 0x followed by 64 hexadecimal characters.",
    "请输入完整交易哈希：0x 后跟 64 位十六进制字符。",
  ],
  INVALID_PROJECT: [
    "Check token addresses and use an HTTPS or IPFS metadata URI.",
    "请核对代币地址，metadata URI 需为 HTTPS 或 IPFS 地址。",
  ],
  INVALID_SECRET: [
    "Enter the original 32-byte secret.",
    "请输入原始的 32 字节 secret。",
  ],
  INVALID_SECRET_HASH: [
    "Enter a complete 32-byte secret hash, or generate one locally.",
    "请输入完整的 32 字节 secret 哈希，或在本地生成。",
  ],
  INVALID_LOCK_ID: [
    "Enter a complete 32-byte lock ID from its creation receipt.",
    "请输入创建回执中的完整 32 字节锁定编号。",
  ],
  LOCK_NOT_FOUND: [
    "No lock was found on this network. Check the network and ID.",
    "此网络未找到锁定记录，请核对网络与编号。",
  ],
  UNSUPPORTED_LAUNCH_CHAIN: ["Choose BSC, Base or Robinhood for this launch.", "请选择 BSC、Base 或 Robinhood 发行。"],
  PONS_WRONG_NETWORK: ["The RPC did not return Robinhood Chain (4663).", "节点返回的网络与 Robinhood Chain（4663）不符。"],
  PONS_PAUSED: ["Pons has paused this launch configuration.", "Pons 当前已暂停此发行配置。"],
  PONS_WALLET_INELIGIBLE: ["Pons has not enabled launches for this wallet.", "Pons 当前未向此钱包开放发行。"],
  PONS_TAX_LIMIT: ["The creator tax exceeds the current Pons maximum.", "创建者税率超出 Pons 当前上限。"],
  PONS_ETH_REQUIRED: ["Your wallet needs ETH on Robinhood Chain for the launch fee, first buy and gas.", "钱包中的 Robinhood Chain ETH 不足以支付发行费、首买和 Gas。"],
  PONS_WALLET_ROUTE: ["Choose the ETH pool and a fee recipient wallet on Robinhood.", "请在 Robinhood 选择 ETH 底池并设置费用接收钱包。"],
  PONS_FIRST_BUY_TOO_SMALL: ["Increase the first buy or set it to zero.", "请提高首买金额或将其设为零。"],
  ROUTE_BSC_ONLY: ["This tax route currently supports BSC. Base supports X giving and wallet recipients.", "此税收渠道目前支持 BSC。Base 支持 X 公益和钱包收款。"],
  QUOTE_DISABLED: [
    "This pool asset is disabled onchain. Choose another asset.",
    "该底池资产已在链上停用，请更换资产。",
  ],
  X_TAX_UNAVAILABLE: [
    "X Money tax settlement is offline.",
    "X Money 税收结算尚未启用。",
  ],
  X_POOL_UNAVAILABLE: [
    "This asset is unavailable in the selected network’s Flap directory.",
    "当前所选网络的 Flap 目录中无法核验此资产。",
  ],
  X_POOL_CONVERSION_UNAVAILABLE: [
    "Pool conversion is currently unavailable.",
    "底池兑换服务暂不可用。",
  ],
  X_TAX_CHECK_REQUIRED: [
    "Verify the X recipient and confirm the selected pool.",
    "请核对 X 收款账户与所选底池。",
  ],
  X_QUOTE_UNAVAILABLE: [
    "The BSC to Base settlement quote is unavailable.",
    "BSC 至 Base 结算报价暂不可用。",
  ],
  X_LOOKUP_UNAVAILABLE: [
    "X account lookup is unavailable.",
    "X 账户查询暂不可用。",
  ],
  X_TAX_CHECK_FAILED: [
    "X Money settlement could not be verified.",
    "暂时无法核对 X Money 结算通道。",
  ],
  X_ACCOUNT_UNVERIFIED: [
    "Check the recipient’s X username.",
    "请核对受益人的 X 用户名。",
  ],
  INVALID_X_HANDLE: ["Enter a valid X handle.", "请填写有效的 X 用户名。"],
  MERCHANT_UNAVAILABLE: [
    "Binance Pay merchant settlement is not configured.",
    "币安 Pay 商户结算尚未配置。",
  ],
  MERCHANT_CHECK_FAILED: [
    "Binance Pay could not verify this recipient. Try again after checking the UID and service.",
    "币安 Pay 未能核验收款人，请检查 UID 与商户服务后重试。",
  ],
  RECIPIENT_CHANGED: [
    "Check the recipient again before signing. The previous check is missing or no longer matches.",
    "请在签名前重新核对收款人，原核验已失效或与当前收款对象不一致。",
  ],
  POST_NOT_LINKED: [
    "This post has no verified Binance Pay UID. Use the recipient’s exchange UID.",
    "该帖子没有已核验的币安 Pay UID，请使用收款人的交易所 UID。",
  ],
  UID_NOT_VALIDATED: [
    "Binance Pay did not validate this UID.",
    "币安 Pay 未核验通过该 UID。",
  ],
  POST_AUTHOR_UNVERIFIED: [
    "The official post or author could not be verified. Check the original public URL.",
    "无法读取并核验官方原帖及作者，请检查公开原帖链接。",
  ],
  POST_PAYOUT_NOT_BOUND: [
    "Register the author’s current signed payout post in Giving, then try this original post again.",
    "请先在公益页登记作者当前的签名收款声明，再用这条原帖重试。",
  ],
  INVALID_RECIPIENT: [
    "Enter a Binance account UID or an official Square post URL.",
    "请输入币安交易所 UID 或官方广场原帖链接。",
  ],
  SALT_MINING_FAILED: [
    "Address preparation timed out. Retry the preview.",
    "地址准备失败，请重新预览。",
  ],
  SALT_ALREADY_USED: [
    "The predicted address already exists. Generate a new preview.",
    "预计地址已存在，请重新生成预览。",
  ],
  PREDICTION_MISMATCH: [
    "The protocol returned a different address. Stop and refresh the configuration.",
    "协议返回地址与预期不符，请停止并刷新配置。",
  ],
  LAUNCH_ADDRESS_NOT_CONFIRMED: [
    "The receipt arrived but the token address could not be verified. Check Activity before trying again.",
    "已取得回执但尚未核对代币地址，请先查看交易记录，不要重复发行。",
  ],
  LAUNCH_METADATA_MISMATCH: [
    "The deployed token details did not match the preview. Inspect the receipt before any further launch.",
    "部署后的代币信息与预览不符，请先核对回执，勿重复发行。",
  ],
  UNSUPPORTED_DECIMALS: [
    "This asset precision is not supported by this interface.",
    "此界面暂不支持该资产的精度。",
  ],
  ABI_UNAVAILABLE: [
    "Contract interface files could not load. Reload the local app.",
    "合约接口文件加载失败，请刷新本地网站。",
  ],
  ZERO_INITIAL_BUY_OUTPUT: [
    "The initial buy would receive no tokens. Change its amount and preview again.",
    "首买将无法获得代币，请修改金额后重新预览。",
  ],
  FACTORY_NOT_DEPLOYED: [
    "This module is not deployed on the selected network. Use BSC for now.",
    "此模块尚未在所选网络部署，目前请使用 BSC。",
  ],
  REGISTRY_NOT_DEPLOYED: [
    "This module is not deployed on the selected network. Use BSC for now.",
    "此模块尚未在所选网络部署，目前请使用 BSC。",
  ],
  SETTLEMENT_NOT_DEPLOYED: [
    "This module is not deployed on the selected network. Use BSC for now.",
    "此模块尚未在所选网络部署，目前请使用 BSC。",
  ],
  INVENTORY_NOT_DEPLOYED: [
    "This module is not deployed on the selected network. Use BSC for now.",
    "此模块尚未在所选网络部署，目前请使用 BSC。",
  ],
  CONNECT_WALLET: ["Connect your wallet to continue.", "请先连接钱包。"],
  WALLET_NOT_FOUND: [
    "No browser wallet detected. Install an EVM wallet and reload.",
    "未检测到浏览器钱包，请安装 EVM 钱包扩展后刷新。",
  ],
  REJECTED: [
    "The request was cancelled in your wallet.",
    "请求已在钱包中取消。",
  ],
  INSUFFICIENT_FUNDS: [
    "Insufficient balance for the transaction and network fee.",
    "余额不足以支付本次交易及网络费。",
  ],
  CALL_REVERTED: [
    "The on-chain simulation reverted. Check parameters and token approvals before retrying.",
    "链上模拟失败，请检查参数与代币授权后重试。",
  ],
  REQUEST_FAILED: [
    "Request failed. Check the network and retry.",
    "请求失败，请检查网络后重试。",
  ],
  INVALID_ADDRESS: ["Enter a valid EVM address.", "请输入有效的 EVM 地址。"],
  INVALID_AMOUNT: [
    "Enter a valid amount within the asset’s decimals.",
    "请输入符合资产精度的有效金额。",
  ],
  RECEIPT_PENDING: [
    "Confirmation is pending. Recover the receipt in Activity; do not repeat the transaction.",
    "回执尚未确认，请到交易记录恢复查询，不要重复提交。",
  ],
  WALLET_CHANGED: [
    "Wallet or network changed. Review the transaction again.",
    "钱包或网络已改变，请重新预览交易。",
  ],
};
export function Status() {
  const { message, setMessage, t, configError, refresh } = useApp();
  return (
    <>
      {configError && (
        <div className="status error">
          {t("Local API is unavailable.", "本地 API 暂不可用。")}
          <button onClick={() => void refresh()}>{t("Retry", "重试")}</button>
        </div>
      )}
      {message && (
        <div className="status" role="status">
          <span>{errors[message] ? t(...errors[message]) : message}</span>
          <button
            aria-label={t("Dismiss message", "关闭提示")}
            onClick={() => setMessage("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </>
  );
}
export function AppFrame() {
  return (
    <Workspace>
      <Status />
      <Outlet />
    </Workspace>
  );
}
export function PageTitle({
  title,
  description,
  aside,
}: {
  title: string;
  description: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <h1>
          <span className="title-line">{title}</span>
        </h1>
        <p>{description}</p>
      </div>
      {aside}
    </div>
  );
}
