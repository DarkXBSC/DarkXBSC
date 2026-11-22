import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  type UTCTimestamp,
} from "lightweight-charts";
import { RefreshCw } from "lucide-react";
import { useApp } from "../lib/context";
type Candle = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};
const number = (v: number) =>
  v.toLocaleString("en", { maximumSignificantDigits: 6 });
export default function CandleChart({ address, chain = "bsc" }: { address: string; chain?: "bsc" | "base" }) {
  const { t, dark } = useApp(),
    host = useRef<HTMLDivElement>(null);
  const [period, setPeriod] = useState("5m"),
    [revision, reload] = useState(0),
    [rows, setRows] = useState<Candle[]>([]),
    [state, setState] = useState("loading"),
    [focus, setFocus] = useState<Candle | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    setState("loading");
    setRows([]);
    setFocus(null);
    (async () => {
      const r = await fetch(
        "/api/market/candles?" + new URLSearchParams({ address, period, chain }),
        { signal: abort.signal },
      );
      const body = await r.json();
      if (!r.ok) throw Error(body.error);
      if (!abort.signal.aborted) {
        setRows(body.candles);
        setState(body.candles.length ? "ready" : "empty");
      }
    })().catch((e) => {
      if (!abort.signal.aborted)
        setState(e.message === "GMGN_BUSY" ? "busy" : "error");
    });
    return () => abort.abort();
  }, [address, period, revision, chain]);
  useEffect(() => {
    if (!host.current || !rows.length) return;
    const line = dark ? "#2e2e2e" : "#e5e5e2",
      text = dark ? "#bbbcb8" : "#565651",
      up = dark ? "#8ae4a9" : "#198345",
      down = dark ? "#ff8996" : "#bb4050";
    const chart = createChart(host.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: dark ? "#171716" : "#fff" },
        textColor: text,
      },
      grid: { vertLines: { color: line }, horzLines: { color: line } },
      rightPriceScale: {
        borderColor: line,
        scaleMargins: { top: 0.04, bottom: 0.04 },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: line,
      },
      localization: { locale: "en-US" },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: up,
      downColor: down,
      wickUpColor: up,
      wickDownColor: down,
      borderVisible: false,
      priceFormat: {
        type: "custom",
        formatter: (v: number) => (v > 0 ? number(v) : v === 0 ? "0" : ""),
        tickmarksFormatter: (values: number[]) =>
          values.map((v) => (v > 0 ? number(v) : v === 0 ? "0" : "")),
        minMove: Math.max(
          1e-18,
          10 **
            (Math.floor(Math.log10(Math.min(...rows.map((r) => r.low)))) - 4),
        ),
      },
    });
    series.setData(rows);
    const vol = chart.addSeries(
      HistogramSeries,
      {
        priceScaleId: "right",
        priceFormat: { type: "volume" },
        lastValueVisible: false,
        priceLineVisible: false,
      },
      1,
    );
    chart.panes()[0].setStretchFactor(4);
    chart.panes()[1].setStretchFactor(1);
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: 0 } });
    vol.setData(
      rows.map((r) => ({
        time: r.time,
        value: r.volume,
        color: r.close >= r.open ? up + "80" : down + "80",
      })),
    );
    chart.timeScale().fitContent();
    setFocus(rows[rows.length - 1]);
    const byTime = new Map(rows.map((r) => [r.time, r]));
    chart.subscribeCrosshairMove((e) =>
      setFocus(byTime.get(e.time as UTCTimestamp) || rows[rows.length - 1]),
    );
    return () => chart.remove();
  }, [rows, dark]);
  return (
    <section
      className="candle-section"
      aria-label={t("Price chart", "价格 K 线")}
    >
      <div className="chart-controls">
        <b>
          {t("Price", "价格")} <small>USD</small>
        </b>
        <div className="chart-periods">
          {["1m", "5m", "15m", "1h", "4h", "1d"].map((p) => (
            <button
              key={p}
              aria-pressed={p === period}
              onClick={() => setPeriod(p)}
            >
              {p}
            </button>
          ))}
        </div>
        <button
          className="round-control"
          aria-label={t("Refresh candles", "刷新 K 线")}
          onClick={() => reload((n) => n + 1)}
        >
          <RefreshCw size={15} />
        </button>
      </div>
      {focus && (
        <div className="candle-readout">
          {(["open", "high", "low", "close", "volume"] as const).map((k, i) => (
            <span key={k}>
              {["O", "H", "L", "C", "Vol $"][i]} <b>{number(focus[k])}</b>
            </span>
          ))}
        </div>
      )}
      {state !== "ready" && (
        <div className="chart-message" role="status">
          {state === "loading"
            ? t("Loading candles…", "正在读取 K 线…")
            : state === "empty"
              ? t("No trades in this time window.", "该时段没有成交。")
              : state === "busy"
                ? t(
                    "GMGN is rate limited. Try again later.",
                    "GMGN 达到限频，请稍后刷新。",
                  )
                : t(
                    "Chart unavailable. Refresh to retry.",
                    "K 线暂不可用，请刷新重试。",
                  )}
        </div>
      )}
      <div ref={host} className="chart-canvas" hidden={state !== "ready"} />
      <div className="chart-credit">
        GMGN · {chain === "base" ? "Base" : "BSC"} · UTC{" "}
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
          TradingView Lightweight Charts™ · © 2025 TradingView, Inc.
        </a>
      </div>
    </section>
  );
}
