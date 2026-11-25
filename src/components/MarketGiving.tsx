import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../lib/context";
import {
  firstReceipt,
  receiptPaths,
  type GivingLedgerData,
} from "../lib/market-receipt.mjs";

function compactAmount(value: string) {
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length <= 6) return value;
  return "≈ " + whole + "." + fraction.slice(0, 6);
}

export default function MarketGiving({ token }: { token: string }) {
  const { t } = useApp();
  const [data, setData] = useState<GivingLedgerData | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, reload] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    let timer: number;
    async function poll() {
      try {
        const response = await fetch(
          "/api/giving/railgun/status?address=" + token,
          {
            cache: "no-store",
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(12000)]),
          },
        );
        if (response.status === 404) {
          if (!abort.signal.aborted) {
            setData(null);
            setFailed(false);
          }
          return;
        }
        if (!response.ok) throw Error();
        const next = await response.json();
        if (
          next.chainId !== 56 ||
          next.rail !== "railgun-tax" ||
          next.token?.toLowerCase() !== token.toLowerCase()
        )
          throw Error();
        if (!abort.signal.aborted) {
          setData(next);
          setFailed(false);
        }
      } catch {
        if (!abort.signal.aborted) setFailed(true);
      }
      if (!abort.signal.aborted) timer = window.setTimeout(poll, 20000);
    }
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [token, revision]);

  if (!data && !failed) return null;
  const batch = data && firstReceipt(data, token);
  const receipt = receiptPaths(token);
  const share = new URL("https://twitter.com/intent/tweet");
  if (batch) {
    share.searchParams.set(
      "text",
      t("First BSC giving receipt", "BSC 首笔公益回执") +
        " · " +
        batch.net +
        " USDT · RAILGUN",
    );
    share.searchParams.set("url", "https://darkwork.fun" + receipt.chart);
  }
  return (
    <aside
      className="market-giving"
      aria-label={t("RAILGUN giving progress", "RAILGUN 公益进度")}
    >
      <header>
        <small>BSC / RAILGUN</small>
        <h3>{t("Giving progress", "公益进度")}</h3>
      </header>
      {failed && (
        <p role="status">
          {t("Ledger refresh failed.", "账本刷新失败。")}{" "}
          <button type="button" onClick={() => reload((n) => n + 1)}>
            {t("Retry", "重试")}
          </button>
        </p>
      )}
      {data && (
        <>
          <div className="giving-gap">
            <span>{t("Needed for next batch", "距下一批还差")}</span>
            <strong title={data.shortfall + " USDT"}>
              {compactAmount(data.shortfall)} <small>USDT</small>
            </strong>
            <progress
              aria-label={t("Next batch funding", "下一批归集进度")}
              max={Number(data.threshold)}
              value={Math.min(Number(data.threshold), Number(data.available))}
            />
          </div>
          <dl>
            <div>
              <dt>{t("USDT collected", "已归集 USDT")}</dt>
              <dd title={data.received}>{compactAmount(data.received)}</dd>
            </div>
            <div>
              <dt>{t("BNB awaiting conversion", "待兑换 BNB")}</dt>
              <dd title={data.conversion?.remaining}>
                {compactAmount(data.conversion?.remaining ?? "0")}
              </dd>
            </div>
          </dl>
          {batch ? (
            <div className="giving-first">
              <strong>{t("Batch #1 confirmed", "首批存入已确认")}</strong>
              <p>
                {t("Net deposit", "实际存入")} {batch.net} USDT
              </p>
              <a
                className="giving-x"
                href={share.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("Share receipt on X", "分享回执到 X")}
              </a>
              <div>
                <a
                  href={receipt.image}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("Receipt image", "回执图片")}
                </a>
                <a
                  href={"https://bscscan.com/tx/" + batch.hash}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  BscScan
                </a>
              </div>
            </div>
          ) : (
            <p className="giving-pending">
              {data.stage === "awaiting-launch"
                ? t("Awaiting finalized launch.", "等待发行最终确认。")
                : data.issue || data.stage === "review"
                  ? t(
                      "See the ledger for the settlement status.",
                      "请到账本查看当前结算状态。",
                    )
                  : ["queued", "approving", "shielding"].includes(data.stage)
                    ? t("First batch is settling.", "首批正在结算。")
                    : t(
                        "First receipt appears after the deposit confirms.",
                        "首笔存入确认后可分享回执。",
                      )}
            </p>
          )}
          <Link
            className="giving-ledger-link"
            to={"/app/giving-ledger/" + token}
          >
            {t("Open giving ledger", "查看公益账本")}
          </Link>
        </>
      )}
    </aside>
  );
}
