import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { Check, Copy, RefreshCw, Star, UsersRound, X } from "lucide-react";
import { CopyText } from "../components/Frame";
import {
  type Asset,
  Change,
  compactUsd,
  TickerStrip,
  TokenArt,
  useMarketBoard,
} from "../components/MarketTicker";
import { useApp } from "../lib/context";
import { short } from "../lib/chain";
import "../bags-market.css";

const CandleChart = lazy(() => import("../components/CandleChart"));
const usd = (v: number | string | null | undefined) =>
  v == null || !Number.isFinite(Number(v))
    ? "—"
    : new Intl.NumberFormat("en", {
        style: "currency",
        currency: "USD",
        notation: Number(v) >= 10000 ? "compact" : "standard",
        maximumSignificantDigits: 4,
      }).format(Number(v));
const same = (a: Asset, b: Asset) =>
  a.address.toLowerCase() === b.address.toLowerCase();
function saved(): Asset[] {
  try {
    const list = JSON.parse(localStorage.getItem("dark:watchlist") || "[]");
    return list
      .filter((r: Asset) => /^0x[\da-f]{40}$/i.test(r.address))
      .slice(0, 100);
  } catch {
    return [];
  }
}
function age(at: number | null) {
  if (!at) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - at) / 60000));
  return minutes < 60
    ? minutes + "m"
    : minutes < 1440
      ? Math.floor(minutes / 60) + "h"
      : Math.floor(minutes / 1440) + "d";
}
const holderCount = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});
function MarketRow({ r, inspect }: { r: Asset; inspect: (r: Asset) => void }) {
  const { t } = useApp();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(r.address);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopyFailed(true);
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setCopied(false);
      setCopyFailed(false);
    }, 1600);
  }
  return (
    <article className="trade-market-row board-asset">
      <button
        type="button"
        className="trade-row-open asset-target"
        onClick={() => inspect(r)}
        aria-label={t("Open chart for ", "查看 K 线 ") + r.symbol}
      />
      <span
        className="trade-art-frame"
        data-curve={r.progress != null && r.progress < 1}
        style={
          {
            "--curve": Math.max(0, Math.min(1, r.progress || 0)) * 360 + "deg",
          } as React.CSSProperties
        }
      >
        <TokenArt asset={r} />
      </span>
      <div className="trade-row-text">
        <div className="trade-row-head">
          <strong title={r.symbol}>{r.symbol}</strong>
          <span className="trade-row-name" title={r.name}>
            {r.name}
          </span>
          <button
            type="button"
            className="trade-copy"
            onClick={copyAddress}
            title={
              copyFailed
                ? r.address
                : t("Copy contract address", "复制合约地址")
            }
            aria-label={
              copied
                ? t("Copied", "已复制")
                : t("Copy contract address for ", "复制合约地址 ") + r.symbol
            }
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
        <span className="trade-cap" title={t("Market cap", "市值")}>
          <small>MC</small>
          {compactUsd(r.marketCap)} <Change value={r.change} />
        </span>
        <div className="trade-row-details">
          <span
            className="trade-meta-chip"
            title={
              r.holders != null ? t("Token holders", "持币地址数") : r.address
            }
          >
            {r.holders != null ? (
              <>
                <UsersRound aria-hidden="true" size={13} />
                {holderCount.format(r.holders)}{" "}
                {t(r.holders === 1 ? "holder" : "holders", "人持有")}
              </>
            ) : (
              short(r.address)
            )}
          </span>
          {r.createdAt != null && (
            <time
              title={new Date(r.createdAt).toLocaleString()}
              dateTime={new Date(r.createdAt).toISOString()}
            >
              {age(r.createdAt)}
            </time>
          )}
        </div>
        <span className="trade-row-cta" aria-hidden="true">
          {t("Chart", "K 线")}
        </span>
      </div>
      {copyFailed && (
        <span className="trade-copy-fallback" role="status">
          {r.address}
        </span>
      )}
    </article>
  );
}

export default function Market({ watchlist = false }: { watchlist?: boolean }) {
  const { t } = useApp(),
    location = useLocation(),
    [params, setParams] = useSearchParams();
  const query = params.get("q")?.trim() || "";
  const token = params.get("token")?.toLowerCase() || "";
  const byVolume = params.get("sort") === "volume";
  const { board, status: boardStatus, reload } = useMarketBoard(true);
  const [result, setResult] = useState<{ rows: Asset[]; checkedAt: string }>({
    rows: [],
    checkedAt: "",
  });
  const [searchStatus, setSearchStatus] = useState("loading"),
    [revision, setRevision] = useState(0);
  const [watch, setWatch] = useState<Asset[]>(saved);
  const [selected, setSelected] = useState<Asset | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const openedToken = useRef("");
  useEffect(() => {
    if (!query) return;
    const abort = new AbortController();
    setSearchStatus("loading");
    setResult({ rows: [], checkedAt: "" });
    fetch("/api/market?query=" + encodeURIComponent(query), {
      signal: abort.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw Error();
        const next = await r.json();
        if (!abort.signal.aborted) {
          setResult({ rows: next.rows, checkedAt: next.checkedAt });
          setSearchStatus("ready");
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setSearchStatus("error");
      });
    return () => abort.abort();
  }, [query, revision]);
  function inspect(r: Asset) {
    setSelected(r);
    dialog.current?.showModal();
  }
  useEffect(() => {
    if (!token) {
      openedToken.current = "";
      return;
    }
    if (openedToken.current === token || !/^0x[\da-f]{40}$/.test(token)) return;
    const carried = location.state?.tickerAsset as Asset | undefined;
    const snapshot =
      carried?.address.toLowerCase() === token
        ? carried
        : Object.values(board.groups)
            .flat()
            .find((r) => r.address.toLowerCase() === token);
    if (snapshot) {
      openedToken.current = token;
      inspect(snapshot);
      return;
    }
    if (boardStatus === "loading") return;
    const abort = new AbortController();
    fetch("/api/market?query=" + token, { signal: abort.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (abort.signal.aborted) return;
        const r = data?.rows?.find(
          (asset: Asset) => asset.address.toLowerCase() === token,
        );
        if (r) {
          openedToken.current = token;
          inspect(r);
        }
      })
      .catch(() => {});
    return () => abort.abort();
  }, [token, location.state, board.groups, boardStatus]);
  function closeChart() {
    setSelected(null);
    if (token) {
      const next = new URLSearchParams(params);
      next.delete("token");
      setParams(next, { replace: true, state: null });
    }
  }
  function toggle(r: Asset) {
    const next = watch.some((x) => same(x, r))
      ? watch.filter((x) => !same(x, r))
      : [r, ...watch].slice(0, 100);
    setWatch(next);
    try {
      localStorage.setItem("dark:watchlist", JSON.stringify(next));
    } catch {}
  }
  const source = query ? "DEX Screener" : board.source;
  const timestamp = query ? result.checkedAt : board.checkedAt;
  const status = query ? searchStatus : boardStatus;
  const liveRows = Object.values(board.groups).flat();
  const groups: Record<string, Asset[]> = watchlist
    ? { saved: watch.map((w) => liveRows.find((r) => same(r, w)) || w) }
    : query
      ? { results: result.rows }
      : board.groups;
  const laneNames: Record<string, string> = {
    new: t("NEW", "新发行"),
    soon: t("SOON", "接近毕业"),
    bonded: t("BONDED", "已毕业"),
    results: t("RESULTS", "搜索结果"),
    saved: t("SAVED", "我的收藏"),
  };
  function sortByVolume(value: boolean) {
    const next = new URLSearchParams(params);
    if (value) next.set("sort", "volume");
    else next.delete("sort");
    setParams(next, { replace: true });
  }
  const waiting = status === "loading" && !watchlist;
  const hasRows = Object.values(groups).some((rows) => rows.length);
  const unavailable = status === "error" && !watchlist;
  const refresh = () => (query ? setRevision((r) => r + 1) : reload());
  return (
    <div className="bags-trade">
      <TickerStrip
        rows={board.groups.bonded || board.groups.results || []}
        onInspect={inspect}
      />
      <div className="trade-heading board-heading">
        <h1>
          {watchlist
            ? t("WATCHLIST", "我的收藏")
            : query
              ? t("SEARCH", "搜索行情")
              : t("TRADE", "交易")}
        </h1>
        {!watchlist && !query ? (
          <div
            className="trade-modes"
            role="group"
            aria-label={t("Market order", "市场排序")}
          >
            <button
              type="button"
              aria-pressed={!byVolume}
              onClick={() => sortByVolume(false)}
            >
              {t("New", "最新")}
            </button>
            <button
              type="button"
              aria-pressed={byVolume}
              title={t(
                "Rank the current markets by 24h USD volume",
                "按当前行情的 24 小时美元成交量排序",
              )}
              onClick={() => sortByVolume(true)}
            >
              {t("Trending", "热门")}
            </button>
          </div>
        ) : (
          <Link className="trade-back" to="/app/explore">
            {t("Trade", "交易行情")}
          </Link>
        )}
      </div>
      {query && (
        <p className="trade-note">
          {t("Search results for", "搜索结果")} “{query}”
        </p>
      )}
      {watchlist && (
        <p className="trade-note">
          {t(
            "Saved on this device. Markets outside the live feed show their last saved quote.",
            "此设备上的收藏。当前行情未覆盖的代币显示收藏时的报价。",
          )}
        </p>
      )}
      {source === "DEX Screener" && !query && !watchlist && (
        <p className="trade-note">
          {t(
            "GMGN stages unavailable. Showing BSC Flap search results from DEX Screener.",
            "GMGN 阶段行情暂不可用，当前显示 DEX Screener 的 BSC Flap 搜索结果。",
          )}
        </p>
      )}
      {unavailable && (
        <div className="trade-notice" role="status">
          {hasRows
            ? t(
                "Market refresh failed. Showing the last update.",
                "行情刷新失败，显示上次更新。",
              )
            : t("Market data unavailable.", "行情暂时不可用。")}
          <button className="trade-back" type="button" onClick={refresh}>
            {t("Retry", "重试")}
          </button>
        </div>
      )}
      {waiting && (
        <span className="trade-sr" role="status">
          {t("Reading BSC markets…", "正在读取 BSC 行情…")}
        </span>
      )}
      <div
        className={
          "trade-board market-board" +
          (!waiting && Object.keys(groups).length === 1
            ? " trade-board-single single"
            : "")
        }
      >
        {Object.entries(
          waiting ? { new: [], soon: [], bonded: [] } : groups,
        ).map(([id, rows]) => {
          const ordered =
            byVolume && !watchlist && !query
              ? [...rows].sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1))
              : rows;
          return (
            <section
              className="trade-lane market-lane"
              key={id}
              data-stage={id}
            >
              <header>
                <h2>{laneNames[id]}</h2>
                <span>{waiting ? "…" : rows.length}</span>
              </header>
              <div
                className="trade-lane-scroll lane-scroll"
                tabIndex={rows.length > 0 ? 0 : -1}
                aria-label={laneNames[id]}
              >
                {waiting ? (
                  <div className="trade-wait" aria-hidden="true">
                    {[0, 1, 2, 3].map((n) => (
                      <div key={n}>
                        <i />
                        <span />
                        <b />
                      </div>
                    ))}
                  </div>
                ) : ordered.length ? (
                  ordered.map((r) => (
                    <MarketRow key={r.address} r={r} inspect={inspect} />
                  ))
                ) : (
                  <p className="trade-empty">
                    {id === "saved"
                      ? t(
                          "Open a chart and star a token to save it here.",
                          "打开 K 线，点击星标即可收藏。",
                        )
                      : t("No matching markets.", "暂无匹配行情。")}
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>
      <div className="trade-source board-foot">
        <span>
          {source || "BSC"}
          {source ? " · BSC" : ""}
          {timestamp && " · " + new Date(timestamp).toLocaleTimeString()}
          {source === "GMGN" &&
            liveRows.some((r) => r.change != null) &&
            t(" · 24h change via DEX Screener", " · 24h 涨跌来自 DEX Screener")}
          {byVolume &&
            !query &&
            !watchlist &&
            t(
              " · Ranked within each stage by 24h volume",
              " · 阶段内按 24h 成交量排序",
            )}
        </span>
        <div>
          <button
            type="button"
            disabled={waiting}
            onClick={refresh}
            aria-label={t("Refresh markets", "刷新行情")}
          >
            <RefreshCw size={13} />
            {t("Refresh", "刷新")}
          </button>
          <Link to="/app/watchlist">
            <Star size={13} />
            {t("Watchlist", "我的收藏")}
            {watch.length > 0 ? " · " + watch.length : ""}
          </Link>
          <Link to="/app/registry">{t("Dark registry", "Dark 登记簿")}</Link>
        </div>
      </div>
      <dialog
        className="market-dialog token-dialog bags-chart-dialog"
        aria-labelledby="bags-chart-title"
        ref={dialog}
        onClose={closeChart}
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current.close();
        }}
      >
        {selected && (
          <div>
            <div className="dialog-heading">
              <div className="dialog-asset">
                <TokenArt asset={selected} />
                <div>
                  <h2 id="bags-chart-title">{selected.symbol}</h2>
                  <span>{selected.name} · BSC</span>
                </div>
              </div>
              <div className="board-actions">
                <button
                  className="round-control"
                  onClick={() => toggle(selected)}
                  aria-label={t("Save token", "收藏代币")}
                  aria-pressed={watch.some((w) => same(w, selected))}
                >
                  <Star
                    size={17}
                    fill={
                      watch.some((w) => same(w, selected))
                        ? "currentColor"
                        : "none"
                    }
                  />
                </button>
                <button
                  className="round-control"
                  aria-label={t("Close chart", "关闭 K 线")}
                  onClick={() => dialog.current?.close()}
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <Suspense
              fallback={
                <div className="chart-message">
                  {t("Loading chart…", "载入图表…")}
                </div>
              }
            >
              <CandleChart address={selected.address} />
            </Suspense>
            <dl className="token-metrics">
              {[
                [t("Price", "价格"), usd(selected.price)],
                [t("Market cap", "市值"), usd(selected.marketCap)],
                [t("24h volume", "24h 成交量"), usd(selected.volume)],
                [t("Liquidity", "流动性"), usd(selected.liquidity)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <CopyText value={selected.address} />
          </div>
        )}
      </dialog>
    </div>
  );
}
