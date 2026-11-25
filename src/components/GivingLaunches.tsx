import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { useApp } from "../lib/context";
import { short } from "../lib/chain";
import { TokenArt, type Asset } from "./MarketTicker";

type Launch = {
  token: string;
  name: string;
  symbol: string;
  image: string;
  share: number;
  shortfall: string;
  firstNet: string | null;
};
type Page = { chainId: 56; rows: Launch[]; nextCursor: string | null };

const displayAmount = (value: string) => {
  const [whole, decimal = ""] = value.split(".");
  return decimal.length > 6 ? "≈ " + whole + "." + decimal.slice(0, 6) : value;
};

export default function GivingLaunches() {
  const { t } = useApp();
  const [history, setHistory] = useState<string[]>([]);
  const [result, setResult] = useState<{ cursor: string; page: Page } | null>(
    null,
  );
  const [failed, setFailed] = useState(false),
    [refreshing, setRefreshing] = useState(true);
  const [revision, reload] = useState(0);
  const cursor = history.at(-1) || "";
  const page = result?.cursor === cursor ? result.page : null;

  useEffect(() => {
    const abort = new AbortController();
    let timer: number;
    setFailed(false);
    async function read() {
      setRefreshing(true);
      try {
        const res = await fetch(
          "/api/giving/railgun/launches" +
            (cursor ? "?before=" + encodeURIComponent(cursor) : ""),
          {
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(12000)]),
            cache: "no-store",
          },
        );
        if (!res.ok) throw Error();
        const data = await res.json();
        if (data.chainId !== 56 || !Array.isArray(data.rows)) throw Error();
        if (!abort.signal.aborted) {
          setResult({ cursor, page: data });
          setFailed(false);
        }
      } catch {
        if (!abort.signal.aborted) setFailed(true);
      } finally {
        if (!abort.signal.aborted) {
          setRefreshing(false);
          timer = window.setTimeout(read, 20000);
        }
      }
    }
    void read();
    return () => {
      abort.abort();
      window.clearTimeout(timer);
    };
  }, [cursor, revision]);

  return (
    <section
      className="giving-launches"
      aria-label={t("Giving launches", "公益发行")}
    >
      <header>
        <div>
          <h2>{t("Giving launches", "公益发行")}</h2>
          <p>
            {t(
              "BSC launches with a verified RAILGUN tax allocation.",
              "已在 BSC 确认发行并核验 RAILGUN 公益分成的代币。",
            )}
          </p>
        </div>
        <button
          type="button"
          className="button"
          disabled={refreshing}
          onClick={() => reload((v) => v + 1)}
        >
          <RefreshCw size={14} />
          {t("Refresh", "刷新")}
        </button>
      </header>
      {failed && (
        <p className="giving-list-message" role="status">
          {page
            ? t(
                "Refresh failed. Showing the last update.",
                "刷新失败，显示上次读取的记录。",
              )
            : t(
                "Giving records are temporarily unavailable. Refresh to retry.",
                "公益记录暂时无法读取，请刷新重试。",
              )}
        </p>
      )}
      {!page && !failed && (
        <p className="giving-list-message" role="status">
          {t("Reading verified launches…", "正在读取已核验的发行记录…")}
        </p>
      )}
      {page?.rows.length === 0 && (
        <div className="giving-list-empty">
          <h3>{t("No verified launches yet", "暂无已核验的公益发行")}</h3>
          <p>
            {t(
              "New tokens appear here after their launch and giving share are confirmed on BSC.",
              "发行交易和公益分成在 BSC 核验后，代币会自动出现在这里。",
            )}
          </p>
          <Link className="button" to="/app/launch?route=railgun">
            {t("Launch a giving token", "发行公益代币")}
          </Link>
        </div>
      )}
      {!!page?.rows.length && (
        <table>
          <thead>
            <tr>
              {[
                t("Token", "代币"),
                t("Giving share of net tax", "净税收公益占比"),
                t("Needed for next batch", "距下一批还差"),
                t("First deposit", "首笔存入"),
                t("Ledger", "账本"),
              ].map((label) => (
                <th scope="col" key={label}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.rows.map((r) => {
              const asset: Asset = {
                chain: "bsc",
                address: r.token,
                symbol: r.symbol || short(r.token),
                name: r.name,
                image: r.image,
                price: null,
                marketCap: null,
                volume: null,
                liquidity: null,
                change: null,
                createdAt: null,
                dex: "",
                url: "",
                buys: null,
                sells: null,
              };
              return (
                <tr key={r.token}>
                  <td>
                    <Link
                      className="giving-row-open"
                      to={"/app/explore?chain=bsc&view=giving&token=" + r.token}
                      state={{ tickerAsset: asset }}
                      aria-label={
                        t("Open chart for ", "查看 K 线 ") + asset.symbol
                      }
                    >
                      <TokenArt asset={asset} />
                      <span>
                        <strong>{asset.symbol}</strong>
                        {r.name && <span>{r.name}</span>}
                        <small title={r.token}>{short(r.token)}</small>
                      </span>
                    </Link>
                  </td>
                  <td>{r.share / 100}%</td>
                  <td title={r.shortfall + " USDT"}>
                    {displayAmount(r.shortfall)} <small>USDT</small>
                  </td>
                  <td>
                    {r.firstNet === null ? (
                      <span className="giving-wait">
                        {t("Awaiting confirmation", "待确认")}
                      </span>
                    ) : (
                      <span className="giving-confirmed">
                        {t("Confirmed", "已确认")}{" "}
                        <small title={r.firstNet + " USDT"}>
                          {displayAmount(r.firstNet)} USDT
                        </small>
                      </span>
                    )}
                  </td>
                  <td>
                    <Link
                      className="giving-row-ledger"
                      to={"/app/giving-ledger/" + r.token}
                      aria-label={
                        t("Open ledger for ", "查看公益账本 ") + asset.symbol
                      }
                    >
                      {t("View ledger", "查看账本")}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {(history.length > 0 || page?.nextCursor) && (
        <nav aria-label={t("Giving launch pages", "公益发行分页")}>
          <button
            className="button"
            disabled={!history.length}
            onClick={() => setHistory((h) => h.slice(0, -1))}
          >
            {t("Previous", "上一页")}
          </button>
          <span>
            {t("Page ", "第 ")}
            {history.length + 1}
            {t("", " 页")}
          </span>
          <button
            className="button"
            disabled={!page?.nextCursor}
            onClick={() => {
              if (page?.nextCursor) setHistory((h) => [...h, page.nextCursor!]);
            }}
          >
            {t("Next", "下一页")}
          </button>
        </nav>
      )}
    </section>
  );
}
