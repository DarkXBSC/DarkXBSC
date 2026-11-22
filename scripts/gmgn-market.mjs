import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
const exec = promisify(execFile);
const cli = fileURLToPath(
  new URL("../node_modules/gmgn-cli/dist/index.js", import.meta.url),
);
const validAddress = /^0x[a-f\d]{40}$/i;
const spans = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
};
const numeric = (v) =>
  (typeof v === "number" || (typeof v === "string" && v.trim())) &&
  Number.isFinite(Number(v))
    ? Number(v)
    : null;
export function normalizeCandles(raw) {
  if (!Array.isArray(raw?.list)) throw Error("GMGN_UNAVAILABLE");
  const keyed = new Map();
  for (const c of raw.list) {
    const stamp = Number(c?.time);
    if (!Number.isFinite(stamp)) continue;
    const time = stamp >= 1e12 ? stamp / 1000 : stamp;
    const [open, high, low, close, volume] = [
      c.open,
      c.high,
      c.low,
      c.close,
      c.volume,
    ].map(numeric);
    if (
      !Number.isSafeInteger(time) ||
      time <= 0 ||
      [open, high, low, close, volume].some((v) => v === null) ||
      low <= 0 ||
      volume < 0 ||
      high < Math.max(open, close) ||
      low > Math.min(open, close)
    )
      continue;
    keyed.set(time, { time, open, high, low, close, volume });
  }
  return [...keyed.values()].sort((a, b) => a.time - b.time).slice(-180);
}
export function normalizeBoard(raw, chain = "bsc") {
  const groups = {};
  for (const [stage, list] of Object.entries({
    new: raw?.new_creation,
    soon: raw?.near_completion ?? raw?.pump,
    bonded: raw?.completed,
  })) {
    if (!Array.isArray(list)) throw Error("GMGN_UNAVAILABLE");
    const seen = new Set();
    groups[stage] = list
      .filter((r) => {
        const key = String(r?.address).toLowerCase();
        if (
          r?.chain !== chain ||
          r?.launchpad_platform !== "flap" ||
          !validAddress.test(key) ||
          seen.has(key)
        )
          return false;
        seen.add(key);
        return true;
      })
      .slice(0, 30)
      .map((r) => ({
        chain,
        address: r.address.toLowerCase(),
        name: String(r.name || "").slice(0, 100),
        symbol: String(r.symbol || "").slice(0, 40),
        dex: "Flap",
        price: numeric(r.price),
        marketCap: numeric(r.market_cap),
        volume: numeric(r.volume_24h),
        liquidity: numeric(r.liquidity),
        createdAt: numeric(r.created_timestamp)
          ? Number(r.created_timestamp) * 1000
          : null,
        buys: numeric(r.buys_24h),
        sells: numeric(r.sells_24h),
        change: null,
        progress: numeric(r.progress),
        holders: numeric(r.holder_count),
        stage,
        image: /^https:\/\/(?:gmgn\.ai|[^/]+\.gmgn\.ai)\//i.test(r.logo)
          ? r.logo
          : "",
        thumb:
          typeof r.logo_small_base64 === "string" &&
          r.logo_small_base64.length < 12000 &&
          /^UklGR[A-Za-z0-9+/]+=*$/.test(r.logo_small_base64)
            ? "data:image/webp;base64," + r.logo_small_base64
            : "",
        url: "https://gmgn.ai/" + chain + "/token/" + r.address,
      }));
  }
  return groups;
}
export function createGmgnMarket(apiKey) {
  const cache = new Map(),
    active = new Map();
  let blockedUntil = 0;
  async function cached(key, args, decode, ttl, chain = "bsc") {
    if (!["bsc", "base"].includes(chain)) throw Error("INVALID_CHART");
    key = chain + ":" + key;
    const old = cache.get(key);
    if (old && old.until > Date.now()) return old.value;
    if (!apiKey) throw Error("GMGN_NOT_CONFIGURED");
    if (Date.now() < blockedUntil || (active.size >= 5 && !active.has(key)))
      throw Error("GMGN_BUSY");
    if (active.has(key)) return active.get(key);
    const run = (async () => {
      try {
        const { stdout } = await exec(
          process.execPath,
          [cli, "market", ...args, "--chain", chain, "--raw"],
          {
            cwd: tmpdir(),
            env: {
              PATH: process.env.PATH,
              GMGN_API_KEY: apiKey,
              GMGN_PRIVATE_KEY: "",
            },
            timeout: 17000,
            maxBuffer: 12_000_000,
          },
        );
        const value = {
          ...decode(JSON.parse(stdout)),
          source: "GMGN",
          chainId: chain === "base" ? 8453 : 56,
          checkedAt: new Date().toISOString(),
        };
        if (cache.size >= 128) cache.delete(cache.keys().next().value);
        cache.set(key, { until: Date.now() + ttl, value });
        return value;
      } catch (e) {
        if (/429|RATE_LIMIT/.test(String(e.stderr) + String(e.stdout))) {
          blockedUntil = Date.now() + 300000;
          throw Error("GMGN_BUSY");
        }
        throw Error("GMGN_UNAVAILABLE");
      } finally {
        active.delete(key);
      }
    })();
    active.set(key, run);
    return run;
  }
  return {
    board: (chain = "bsc") =>
      cached(
        "board",
        ["trenches", "--launchpad-platform", "flap", "--limit", "30"],
        (raw) => ({ groups: normalizeBoard(raw, chain) }),
        45000, chain,
      ),
    candles: (address, period, chain = "bsc") => {
      if (!validAddress.test(address) || !Object.hasOwn(spans, period))
        throw Error("INVALID_CHART");
      const to = Math.floor(Date.now() / 1000);
      return cached(
        address.toLowerCase() + ":" + period,
        [
          "kline",
          "--address",
          address,
          "--resolution",
          period,
          "--from",
          String(to - 180 * spans[period]),
          "--to",
          String(to),
        ],
        (raw) => ({ address, period, candles: normalizeCandles(raw) }),
        20000, chain,
      );
    },
  };
}
