export function createMarketReader({
  fetcher = fetch,
  now = () => Date.now(),
} = {}) {
  const cache = new Map();
  return async function market(raw = "flap", chain = "bsc") {
    if (!["bsc", "base"].includes(chain)) throw Error("INVALID_SEARCH");
    const query = raw.trim() || "flap";
    if (query.length > 80 || /[\x00-\x1f]/.test(query))
      throw Error("INVALID_SEARCH");
    const hit = cache.get(chain + ":" + query);
    if (hit && now() - hit.at < 30000) return hit.data;
    const res = await fetcher(
      "https://api.dexscreener.com/latest/dex/search?q=" +
        encodeURIComponent(query),
      { signal: AbortSignal.timeout(12000) },
    );
    if (!res.ok) throw Error("MARKET_UNAVAILABLE");
    const json = await res.json();
    if (!Array.isArray(json.pairs)) throw Error("MARKET_UNAVAILABLE");
    const finite = (v) =>
      typeof v === "number" && Number.isFinite(v) ? v : null;
    const rows = json.pairs
      .filter(
        (p) =>
          p.chainId === chain &&
          /^0x[\da-f]{40}$/i.test(p.baseToken?.address) &&
          /^0x[\da-f]{40}$/i.test(p.pairAddress),
      )
      .map((p) => ({
        chain,
        address: p.baseToken.address,
        pair: p.pairAddress,
        name: String(p.baseToken.name || "").slice(0, 100),
        symbol: String(p.baseToken.symbol || "").slice(0, 32),
        dex: String(p.dexId || ""),
        quote: String(p.quoteToken?.symbol || ""),
        price:
          typeof p.priceUsd === "string" && Number.isFinite(Number(p.priceUsd))
            ? p.priceUsd
            : null,
        change: finite(p.priceChange?.h24),
        volume: finite(p.volume?.h24),
        liquidity: finite(p.liquidity?.usd),
        marketCap: finite(p.marketCap),
        createdAt: finite(p.pairCreatedAt),
        buys: finite(p.txns?.h24?.buys),
        sells: finite(p.txns?.h24?.sells),
        image:
          typeof p.info?.imageUrl === "string" &&
          p.info.imageUrl.startsWith("https://cdn.dexscreener.com/")
            ? p.info.imageUrl
            : "",
        url: "https://dexscreener.com/" + chain + "/" + p.pairAddress,
      }))
      .sort((a, b) => (b.liquidity || 0) - (a.liquidity || 0));
    const seen = new Set();
    const data = {
      source: "DEX Screener",
      query,
      chainId: chain === "base" ? 8453 : 56,
      checkedAt: new Date(now()).toISOString(),
      rows: rows
        .filter((r) => {
          const k = r.address.toLowerCase();
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .slice(0, 30),
    };
    if (cache.size > 60) cache.clear();
    cache.set(chain + ":" + query, { at: now(), data });
    return data;
  };
}
