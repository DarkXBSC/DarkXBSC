import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { ChevronDown, Moon, Search, Sun, X } from "lucide-react";
import { useApp } from "../lib/context";
import { short } from "../lib/chain";
import MarketTicker from "./MarketTicker";
import LanguageSwitch from "./LanguageSwitch";

const navigation = [
  ["/app/home", "Home", "首页"],
  ["/app/hire", "Hire an Agent", "招个 Agent"],
  ["/app/launch", "Launch", "发行"],
  ["/app/explore", "Trade", "行情"],
  ["/app/impact", "Giving", "公益"],
  ["/app/learn", "Docs", "教材"],
] as const;
const tools = [
  ["/app/railgun", "RAILGUN shield", "RAILGUN 隐私存入"],
  ["/app/contracts", "Contracts & source", "合约与源码"],
  ["/app/watchlist", "Watchlist", "我的收藏"],
  ["/app/registry", "BSC registry", "BSC 登记簿"],
  ["/app/wallet-pay", "Wallet payments", "钱包支付"],
  ["/app/agent-otc", "Agent OTC", "Agent OTC"],
  ["/app/otc", "Private quotes", "私下报价"],
  ["/app/rebalance", "Inventory", "库存管理"],
  ["/app/agent-pay", "Treasury planning", "资金计划"],
  ["/app/activity", "Activity", "交易记录"],
] as const;

export default function Workspace({ children }: { children: ReactNode }) {
  const { t, dark, toggleTheme, account, connect, disconnect } = useApp();
  const location = useLocation(),
    navigate = useNavigate();
  const home = location.pathname === "/app/home",
    launch = location.pathname === "/app/launch";
  const trade = ["/app/explore", "/app/watchlist"].includes(location.pathname);
  const giving = location.pathname === "/app/impact";
  const toolPage = tools.some(([url]) => url === location.pathname);
  const search = useRef<HTMLDialogElement>(null),
    menu = useRef<HTMLDialogElement>(null),
    wallet = useRef<HTMLDetailsElement>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    search.current?.close();
    menu.current?.close();
    if (wallet.current) wallet.current.open = false;
    if (!location.hash) window.scrollTo(0, 0);
  }, [location.pathname, location.search, location.hash]);
  useEffect(() => {
    function outside(e: PointerEvent) {
      if (wallet.current && !wallet.current.contains(e.target as Node))
        wallet.current.open = false;
    }
    function key(e: KeyboardEvent) {
      if (e.key === "Escape" && wallet.current?.open) {
        wallet.current.open = false;
        wallet.current.querySelector("summary")?.focus();
      }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, []);
  return (
    <div
      className="workspace exchange bags-desk"
      data-surface={
        home
          ? "home"
          : launch
            ? "launch"
            : trade
              ? "trade"
              : giving
                ? "giving"
                : "tools"
      }
    >
      <header className="bags-top">
        <div className="bags-identity">
          <Link
            to="/app/home"
            className="bags-brand"
            aria-label={t("Dark home", "Dark 首页")}
          >
            <img src="/brand/dark-mark.png" alt="" width="34" height="34" />
            Dark
          </Link>
          <LanguageSwitch className="bags-language" />
        </div>
        <nav
          className="bags-nav"
          aria-label={t("Primary navigation", "主导航")}
        >
          {navigation.map(([url, en, cn]) => (
            <NavLink
              key={url}
              to={url}
              className={({ isActive }) => (isActive ? "selected" : "")}
            >
              {t(en, cn)}
            </NavLink>
          ))}
          <button
            type="button"
            className={toolPage ? "selected" : ""}
            aria-haspopup="dialog"
            aria-controls="desk-tools-dialog"
            onClick={() => menu.current?.showModal()}
          >
            {t("More tools", "更多工具")}
          </button>
        </nav>
        <div className="bags-utilities">
          <button
            className="bags-circle"
            aria-label={t("Search BSC and Base markets", "搜索 BSC 和 Base 市场")}
            onClick={() => {
              setQuery("");
              search.current?.showModal();
            }}
          >
            <Search size={19} />
          </button>
          {trade && (
            <button
              className="bags-network"
              aria-label={t("Networks and tools", "网络和工具")}
              title={t("Networks and tools", "网络和工具")}
              aria-haspopup="dialog"
              aria-controls="desk-tools-dialog"
              onClick={() => menu.current?.showModal()}
            >
              <span className="bnb-mark" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
                <i />
              </span>
              <ChevronDown size={12} />
            </button>
          )}
          {!launch && !home && (
            <Link to="/app/launch" className="bags-action">
              {t("new coin", "发新币")}
            </Link>
          )}
          {account ? (
            <details className="bags-wallet" ref={wallet}>
              <summary className="bags-action">
                {short(account)} <ChevronDown size={13} />
              </summary>
              <button onClick={disconnect}>
                {t("Disconnect", "断开连接")}
              </button>
            </details>
          ) : (
            <button className="bags-action" onClick={() => void connect()}>
              {t("connect", "连接钱包")}
            </button>
          )}
        </div>
      </header>
      {(home || giving) && <MarketTicker />}
      <main className="desk-main" key={location.pathname}>
        {children}
      </main>
      <footer className="bags-footer">
        <span className="foot-name">Dark · BSC · Base · Robinhood</span>
        <div className="foot-links">
          <Link to="/about">{t("About", "关于")}</Link>
          <Link to="/app/contracts">{t("Contracts", "合约与源码")}</Link>
          <Link to="/app/learn">{t("Docs", "教材")}</Link>
          <a
            href="https://x.com/DarkLBSC"
            target="_blank"
            rel="noreferrer"
            aria-label={t("DarkLBSC on X", "DarkLBSC 的 X 账号")}
          >
            DarkLBSC
          </a>
          <button
            aria-haspopup="dialog"
            aria-controls="desk-tools-dialog"
            onClick={() => menu.current?.showModal()}
          >
            {t("Tools", "更多工具")}
          </button>
        </div>
        <div className="foot-settings">
          <LanguageSwitch />
          <button
            onClick={toggleTheme}
            aria-label={t("Switch theme", "切换主题")}
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </footer>
      <dialog
        className="market-dialog bags-popup"
        ref={search}
        aria-labelledby="desk-search-title"
        onClick={(e) => {
          if (e.target === search.current) search.current?.close();
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim()) {
              search.current?.close();
              navigate("/app/explore?chain=" + (new URLSearchParams(location.search).get("chain") === "base" ? "base" : "bsc") + "&q=" + encodeURIComponent(query.trim()));
            }
          }}
        >
          <div className="dialog-heading">
            <h2 id="desk-search-title">{t("Search tokens", "搜索代币")}</h2>
            <button
              type="button"
              className="bags-circle"
              aria-label={t("Close", "关闭")}
              onClick={() => search.current?.close()}
            >
              <X size={18} />
            </button>
          </div>
          <label>
            {t("Symbol or token contract", "代币代码或合约地址")}
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={80}
            />
          </label>
          <button className="bags-action" disabled={!query.trim()}>
            {t("Search markets", "搜索行情")}
          </button>
        </form>
      </dialog>
      <dialog
        className="market-dialog bags-popup"
        ref={menu}
        id="desk-tools-dialog"
        aria-labelledby="desk-tools-title"
        onClick={(e) => {
          if (e.target === menu.current) menu.current?.close();
        }}
      >
        <div className="dialog-heading">
          <h2 id="desk-tools-title">{t("Network tools", "网络工具")}</h2>
          <button
            className="bags-circle"
            aria-label={t("Close", "关闭")}
            onClick={() => menu.current?.close()}
          >
            <X size={18} />
          </button>
        </div>
        <div className="bags-menu-links">
          {tools.map(([url, en, cn]) => (
            <NavLink to={url} onClick={() => menu.current?.close()} key={url}>
              {t(en, cn)}
            </NavLink>
          ))}
          <a href="/dark-genesis-source.zip" download>
            {t("Download source", "下载源码")}
          </a>
        </div>
      </dialog>
    </div>
  );
}
