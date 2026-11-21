import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../lib/context";
import "../bags-market.css";

export type Asset = {
  address: string;
  name: string;
  symbol: string;
  price: number | string | null;
  marketCap: number | null;
  volume: number | null;
  liquidity: number | null;
  change: number | null;
  createdAt: number | null;
  dex: string;
  image: string;
  thumb?: string;
  url: string;
  holders?: number | null;
  progress?: number | null;
  buys: number | null;
  sells: number | null;
};
type Board = {
  groups: Record<string, Asset[]>;
  source: string;
  checkedAt: string;
};
const empty: Board = { groups: {}, source: "", checkedAt: "" };
const addressPattern = /^0x[\da-f]{40}$/i;
let current: Board | undefined;
let expires = 0;
let pending: Promise<Board> | undefined;

async function fetchBoard(): Promise<Board> {
  const response = await fetch("/api/market/board", {
    signal: AbortSignal.timeout(22000),
  });
  if (response.ok) return { ...(await response.json()), source: "GMGN" };
  const fallback = await fetch("/api/market?query=flap", {
    signal: AbortSignal.timeout(15000),
  });
  if (!fallback.ok) throw Error("MARKET_UNAVAILABLE");
  const result = await fallback.json();
  return {
    groups: { results: result.rows },
    checkedAt: result.checkedAt,
    source: "DEX Screener",
  };
}
function readBoard(force: boolean) {
  if (!force && current && Date.now() < expires)
    return Promise.resolve(current);
  if (!pending)
    pending = fetchBoard()
      .then((board) => {
        current = board;
        expires = Date.now() + 45000;
        return board;
      })
      .finally(() => {
        pending = undefined;
      });
  return pending;
}

type DexPair = {
  chainId: string;
  baseToken?: { address: string };
  liquidity?: { usd?: number };
  priceChange?: { h24?: number };
};
let pricedSnapshot: Board | undefined;
let priceRequest: Promise<Board> | undefined;
function withDailyChanges(board: Board) {
  if (pricedSnapshot === board && priceRequest) return priceRequest;
  pricedSnapshot = board;
  const addresses = [
    ...new Set(
      Object.values(board.groups)
        .flat()
        .filter((r) => r.change == null && addressPattern.test(r.address))
        .map((r) => r.address.toLowerCase()),
    ),
  ];
  const batches: Promise<DexPair[]>[] = [];
  for (let i = 0; i < addresses.length; i += 30) {
    const list = addresses.slice(i, i + 30);
    batches.push(
      fetch("https://api.dexscreener.com/tokens/v1/bsc/" + list.join(","), {
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(6500),
      })
        .then(async (r) => (r.ok ? await r.json() : []))
        .catch(() => []),
    );
  }
  priceRequest = Promise.all(batches).then((batches) => {
    const prices = new Map<string, { liquidity: number; change: number }>();
    for (const pairs of batches) {
      if (!Array.isArray(pairs)) continue;
      for (const p of pairs) {
        const address = p.baseToken?.address?.toLowerCase();
        const change = p.priceChange?.h24;
        if (
          p.chainId !== "bsc" ||
          !address ||
          !addressPattern.test(address) ||
          typeof change !== "number" ||
          !Number.isFinite(change)
        )
          continue;
        const liquidity = Number(p.liquidity?.usd) || 0;
        if (!prices.has(address) || liquidity > prices.get(address)!.liquidity)
          prices.set(address, { liquidity, change });
      }
    }
    if (!prices.size) return board;
    const groups = Object.fromEntries(
      Object.entries(board.groups).map(([id, rows]) => [
        id,
        rows.map((row) => {
          const price = prices.get(row.address.toLowerCase());
          return !price || row.change != null
            ? row
            : { ...row, change: price.change };
        }),
      ]),
    );
    return { ...board, groups };
  });
  return priceRequest;
}

export function useMarketBoard(active = true) {
  const [board, setBoard] = useState<Board>(current || empty);
  const [status, setStatus] = useState<"ready" | "loading" | "error">(
    current ? "ready" : "loading",
  );
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!active) return;
    let mounted = true;
    let seq = 0;
    async function refresh(force: boolean) {
      const seqId = ++seq;
      const live = () => mounted && seq === seqId;
      try {
        const next = await readBoard(force);
        if (!live()) return;
        setBoard(next);
        setStatus("ready");
        if (next.source === "GMGN") {
          const priced = await withDailyChanges(next);
          if (live()) setBoard(priced);
        }
      } catch {
        if (live()) setStatus("error");
      }
    }
    void refresh(revision > 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh(false);
    }, 60000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [active, revision]);
  return { board, status, reload: () => setRevision((r) => r + 1) };
}
export function TokenArt({ asset }: { asset: Asset }) {
  const [failed, setFailed] = useState<string[]>([]);
  const urls = [asset.thumb, asset.image];
  const src = urls.find((url) => url && !failed.includes(url));
  return (
    <span className="trade-token-art" aria-hidden="true">
      {src ? (
        <img
          src={src}
          loading="lazy"
          alt=""
          referrerPolicy="no-referrer"
          onError={() =>
            setFailed((prev) => (prev.includes(src) ? prev : [...prev, src]))
          }
        />
      ) : (
        asset.symbol.slice(0, 2)
      )}
    </span>
  );
}
export function Change({ value }: { value: number | null }) {
  return typeof value === "number" && Number.isFinite(value) ? (
    <span
      className={
        value < 0 ? "trade-down" : value > 0 ? "trade-up" : "trade-flat"
      }
      title="24h · DEX Screener"
    >
      {value > 0 ? "+" : ""}
      {new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value)}%
    </span>
  ) : null;
}
export function TickerStrip({
  rows,
  onInspect,
}: {
  rows: Asset[];
  onInspect: (r: Asset) => void;
}) {
  const { t } = useApp();
  const available = rows.filter((r) => r.change != null);
  const list = (available.length ? available : rows).slice(0, 16);
  return (
    <div
      className="bags-ticker"
      aria-label={t("BSC market ticker", "BSC 行情带")}
    >
      {list.length > 0 && (
        <div className="bags-ticker-track">
          {[0, 1].map((copy) => (
            <div
              className="bags-ticker-loop"
              key={copy}
              aria-hidden={copy === 1}
            >
              {list.map((row) => (
                <button
                  type="button"
                  key={row.address}
                  tabIndex={copy === 1 ? -1 : 0}
                  onClick={() => onInspect(row)}
                  aria-label={t("Open chart for ", "查看 K 线 ") + row.symbol}
                >
                  <TokenArt asset={row} />
                  <strong>${row.symbol}</strong>
                  {row.change != null ? (
                    <Change value={row.change} />
                  ) : row.marketCap != null ? (
                    <span>MC {compactUsd(row.marketCap)}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
const amount = new Intl.NumberFormat("en", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});
export const compactUsd = (n: number | null) =>
  n == null || !Number.isFinite(n) ? "—" : amount.format(n);
export default function MarketTicker() {
  const { board } = useMarketBoard();
  const navigate = useNavigate();
  return (
    <TickerStrip
      rows={board.groups.bonded || board.groups.results || []}
      onInspect={(r) =>
        navigate("/app/explore?token=" + r.address, {
          state: { tickerAsset: r },
        })
      }
    />
  );
}
