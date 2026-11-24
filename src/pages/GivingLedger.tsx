import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getAddress, isAddress } from "ethers";
import { useApp } from "../lib/context";
import { CopyText } from "../components/Frame";
import "./giving-ledger.css";

type Batch = {
  seq: number;
  stage: string;
  hash: string | null;
  net: string | null;
  fee: string | null;
  gross: string;
  block: number | null;
};
type Ledger = {
  rail: string;
  chainId: number;
  token: string;
  collector: string;
  share: number;
  creation: string | null;
  lastBlock: number;
  received: string;
  available: string;
  threshold: string;
  shortfall: string;
  shielded: string;
  issue: string;
  stage: string;
  batches: Batch[];
  conversion?: {
    earned: string;
    remaining: string;
    last?: { hash: string; actual: string; stage: string };
  };
};
const issues: Record<string, [string, string]> = {
  RAIL_LAUNCH_MISMATCH: [
    "Launch parameters did not match this reservation. Settlement is paused.",
    "发行参数与登记记录不符，结算已暂停。",
  ],
  RAIL_RECEIPT_REVIEW: [
    "The settlement receipt needs verification. The batch remains reserved.",
    "结算回执待复核，款项仍为该批次保留。",
  ],
  RAIL_BALANCE_REVIEW: [
    "Checking the collection wallet balance.",
    "正在复核归集钱包余额。",
  ],
  X_GAS_FUNDING: [
    "Waiting for sponsored gas to confirm.",
    "等待代付 Gas 到账确认。",
  ],
  X_GAS_SPONSOR_LOW: [
    "Waiting for the sponsor wallet to be funded.",
    "等待代付钱包补充 Gas。",
  ],
  X_GAS_PRICE_HIGH: [
    "Waiting for gas to return within the configured limit.",
    "等待 Gas 价格回到结算限额内。",
  ],
  X_SERVICE_WAIT: [
    "Waiting for the network or settlement provider.",
    "等待网络或结算服务响应。",
  ],
};
const stages: Record<string, [string, string]> = {
  "awaiting-launch": ["Awaiting finalized launch", "等待发行最终确认"],
  collecting: ["Collecting tax", "归集税收中"],
  queued: ["Batch reserved", "已为本批预留款项"],
  approving: ["Confirming USDT approval", "正在确认 USDT 授权"],
  shielding: ["Confirming shield deposit", "正在确认隐私存入"],
  confirmed: ["Shield confirmed", "已存入隐私池"],
  review: ["Receipt needs review", "回执待复核"],
};
export default function GivingLedger() {
  const { token = "" } = useParams(),
    { t } = useApp(),
    navigate = useNavigate();
  const [input, setInput] = useState(token),
    [state, setState] = useState<"loading" | "ready" | "missing" | "error">(
      "loading",
    ),
    [data, setData] = useState<Ledger | null>(null),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    setData(null);
    setInput(token);
    setCopied(false);
    if (!isAddress(token)) {
      setState("missing");
      return;
    }
    const abort = new AbortController();
    let timer: number;
    const read = async () => {
      try {
        const response = await fetch(
          "/api/giving/railgun/status?address=" + encodeURIComponent(token),
          { signal: abort.signal, cache: "no-store" },
        );
        if (response.status === 404) {
          const x = await fetch(
            "/api/giving/x/status?chainId=56&address=" +
              encodeURIComponent(token),
            { signal: abort.signal },
          );
          if (x.ok && (await x.json()).rail === "xmoney-tax") {
            navigate("/app/impact?view=track&chain=bsc&token=" + token, {
              replace: true,
            });
            return;
          }
          if (x.status !== 404) throw Error();
          setState("missing");
          return;
        }
        if (!response.ok) throw Error();
        const ledger = await response.json();
        if (ledger.rail !== "railgun-tax" || ledger.chainId !== 56)
          throw Error();
        setData(ledger);
        setState("ready");
      } catch {
        if (!abort.signal.aborted) setState("error");
      } finally {
        if (!abort.signal.aborted) timer = window.setTimeout(read, 20000);
      }
    };
    setState("loading");
    void read();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [token, navigate]);
  const tx = (hash: string, label: string) => (
    <a href={"https://bscscan.com/tx/" + hash} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
  return (
    <div className="giving-ledger">
      <header>
        <small>BSC · RAILGUN</small>
        <h1>{t("Public giving ledger", "公开公益账本")}</h1>
        <p>
          {t(
            "Track trading tax from collection to a confirmed private deposit.",
            "查看一枚代币的公益税收，从公开归集到隐私存入的最终回执。",
          )}
        </p>
      </header>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (isAddress(input.trim()))
            navigate("/app/giving-ledger/" + getAddress(input.trim()));
        }}
      >
        <label>
          {t("Token or collector address", "代币或归集地址")}
          <input
            value={input}
            placeholder="0x…"
            spellCheck={false}
            onChange={(e) => setInput(e.target.value)}
          />
        </label>
        <button className="bags-action" disabled={!isAddress(input.trim())}>
          {t("Look up", "查询")}
        </button>
      </form>
      {token && state === "loading" && (
        <p role="status">{t("Reading ledger…", "正在读取账本…")}</p>
      )}
      {token && state === "missing" && (
        <p role="status">
          {t(
            "No BSC giving ledger was found for this address.",
            "该地址暂无 BSC 公益账本。",
          )}
        </p>
      )}
      {state === "error" && (
        <p role="alert">
          {t(
            "Update unavailable. Retrying shortly.",
            "暂时无法刷新，稍后自动重试。",
          )}
        </p>
      )}
      {data && (
        <>
          <section>
            <strong>{t(...(stages[data.stage] || stages.collecting))}</strong> ·{" "}
            {data.share / 100}% {t("of net tax", "净税收用于公益")}
            <div className="ledger-totals">
              {[
                [t("Collected in USDT", "累计已归集 USDT"), data.received],
                [t("Outside active batches", "尚未分批 USDT"), data.available],
                [
                  t("Confirmed private deposits", "隐私池累计实收 USDT"),
                  data.shielded,
                ],
              ].map(([k, v]) => (
                <div key={k}>
                  <small>{k}</small>
                  <strong>{v}</strong>
                </div>
              ))}
            </div>
            <p>
              {t("Batch size", "每批")} {data.threshold} USDT ·{" "}
              {t(
                "Needed for the next unreserved batch",
                "距下一笔未预留批次还差",
              )}{" "}
              {data.shortfall} USDT
            </p>
            {data.conversion && (
              <p>
                {t("BNB tax collected", "已归集 BNB 税收")}{" "}
                {data.conversion.earned} BNB ·{" "}
                {t("Awaiting conversion", "待兑换")} {data.conversion.remaining}{" "}
                BNB{" "}
                {data.conversion.last?.hash &&
                  tx(
                    data.conversion.last.hash,
                    t("Conversion transaction", "兑换交易"),
                  )}
              </p>
            )}
            {data.issue && (
              <p role="status">
                {t("Settlement update", "结算状态")} ·{" "}
                {issues[data.issue] ? t(...issues[data.issue]) : data.issue}
              </p>
            )}
            <p>
              {t("Public collection wallet", "公开归集钱包")}{" "}
              <CopyText value={data.collector} />
            </p>
            <p>
              {data.creation && (
                <>{tx(data.creation, t("Launch receipt", "发行回执"))} · </>
              )}{" "}
              {t("Last scanned BSC block", "已扫描至 BSC 区块")}{" "}
              {data.lastBlock}
            </p>
            <button
              className="button"
              onClick={() => {
                navigator.clipboard
                  .writeText(
                    location.origin + "/app/giving-ledger/" + data.token,
                  )
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false));
              }}
            >
              {copied
                ? t("Copied", "已复制")
                : t("Copy ledger link", "复制账本链接")}
            </button>
          </section>
          <section>
            <h2>{t("Settlement batches", "结算批次")}</h2>
            {!data.batches.length ? (
              <p>
                {t(
                  "The first batch opens once 25 USDT of confirmed tax is available.",
                  "已确认的公益税收达到 25 USDT 后，第一批会出现在这里。",
                )}
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    {[
                      t("Batch", "批次"),
                      t("Status", "状态"),
                      t("Gross USDT", "总额 USDT"),
                      t("Protocol fee", "协议费"),
                      t("Net USDT", "实收 USDT"),
                      t("Evidence", "凭证"),
                    ].map((k) => (
                      <th key={k}>{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.batches.map((b) => (
                    <tr key={b.seq}>
                      <td>{b.seq}</td>
                      <td>{t(...(stages[b.stage] || stages.review))}</td>
                      <td>{b.gross}</td>
                      <td>{b.fee ?? "—"}</td>
                      <td>{b.net ?? "—"}</td>
                      <td>
                        {b.hash
                          ? tx(
                              b.hash,
                              b.block
                                ? String(b.block)
                                : t("Transaction", "交易"),
                            )
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
      <Link to="/app/launch?route=railgun">
        {t("Launch with RAILGUN giving", "发行 RAILGUN 公益代币")}
      </Link>
    </div>
  );
}
