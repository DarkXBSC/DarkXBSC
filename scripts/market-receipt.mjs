// Public-only chart previews. Both the browser link and the X crawler use this URL.
import { readFileSync } from "node:fs";
import { Interface } from "ethers";
import { firstReceipt, receiptPaths } from "../src/lib/market-receipt.mjs";
import { publicUrl } from "../src/lib/public-url.mjs";

const site = "https://darkwork.fun";
const iface = new Interface(
  JSON.parse(readFileSync("public/contracts/IPortal.abi.json")),
);
const portal = JSON.parse(
  readFileSync("public/protocols.json"),
).flap.portal.toLowerCase();
const addressPattern = /^0x[0-9a-f]{40}$/i;
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

export function receiptRoute(url) {
  const image = /^\/receipts\/bsc\/(0x[\da-f]{40})\/1\.png$/i.exec(
    url.pathname,
  );
  if (image) return { token: image[1].toLowerCase(), image: true };
  const token = url.searchParams.get("token");
  if (
    url.pathname === "/app/explore" &&
    url.searchParams.get("chain") === "bsc" &&
    url.searchParams.get("receipt") === "1" &&
    addressPattern.test(token || "")
  )
    return { token: token.toLowerCase(), image: false };
  return null;
}

function previewTags(card) {
  const paths = receiptPaths(card.token);
  const title = card.symbol + " · " + card.net + " USDT · Giving receipt #1";
  const description =
    "Confirmed BSC RAILGUN deposit. View the chart and verify batch #1 on BscScan.";
  const meta = (name, value) =>
    "<meta " +
    (name.startsWith("og:") ? "property" : "name") +
    '="' +
    name +
    '" content="' +
    escape(value) +
    '">';
  return [
    meta("og:type", "website"),
    meta("og:url", site + paths.chart),
    meta("og:title", title),
    meta("og:description", description),
    meta("og:image", site + paths.image),
    meta("og:image:type", "image/png"),
    meta("og:image:width", "1200"),
    meta("og:image:height", "630"),
    meta("twitter:card", "summary_large_image"),
    meta("twitter:title", title),
    meta("twitter:description", description),
    meta("twitter:image", site + paths.image),
    meta("twitter:image:alt", title),
    meta("dark:receipt-token", card.token),
    meta("dark:receipt-symbol", card.symbol),
  ].join("\n");
}

async function readArtwork(response) {
  if (
    !response.ok ||
    Number(response.headers.get("content-length")) > 8 * 1024 * 1024
  ) {
    await response.body?.cancel();
    throw Error("ART_UNAVAILABLE");
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > 8 * 1024 * 1024) throw Error("ART_TOO_LARGE");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function receiptPng(card, art) {
  const { default: sharp } = await import("sharp");
  // Only raster formats supported by the launch form may be decoded.
  const png = art.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
  const jpeg = art[0] === 255 && art[1] === 216 && art[2] === 255;
  const webp =
    art.toString("ascii", 0, 4) === "RIFF" &&
    art.toString("ascii", 8, 12) === "WEBP";
  if (!png && !jpeg && !webp) throw Error("INVALID_ART");
  const cover = await sharp(art, { limitInputPixels: 25000000 })
    .rotate()
    .resize(386, 386, { fit: "cover" })
    .flatten({ background: "#202426" })
    .png()
    .toBuffer();
  const symbol = escape(card.symbol),
    net = escape(card.net),
    hash = escape(card.hash);
  const svg =
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <rect width="1200" height="630" fill="#111514"/>
    <g font-family="DejaVu Sans,sans-serif" fill="#f5f6f3">
    <text x="48" y="67" font-size="33" font-weight="bold">Dark</text>
    <text x="1152" y="62" font-size="20" fill="#b3beb9" text-anchor="end">BSC  /  RAILGUN</text>
    <path d="M48 94H1152 M48 515H1152" fill="none" stroke="#454c48" stroke-width="2"/>
    <text x="48" y="170" font-size="22" fill="#acddb0">GIVING RECEIPT  /  BATCH #1</text>
    <text x="48" y="251" font-size="48" font-weight="bold">${symbol}</text>
    <text x="48" y="342" font-size="${Math.min(72, Math.floor(1000 / card.net.length))}" font-weight="bold">${net}</text>
    <text x="50" y="386" font-size="26">USDT net deposited</text>
    <text x="48" y="470" font-size="19" fill="#c2cac5">Confirmed on BSC · block ${card.block}</text>
    <text x="48" y="554" font-size="17" fill="#b3beb9">BscScan transaction</text>
    <text x="48" y="590" font-family="DejaVu Sans Mono,monospace" font-size="22">${hash}</text>
    </g></svg>`);
  return sharp(svg)
    .composite([{ input: cover, left: 766, top: 111 }])
    .png()
    .toBuffer();
}

export function createReceiptHandler({
  api,
  giving = api,
  readIndex,
  fetcher = fetch,
}) {
  const cache = new Map(),
    pending = new Map();
  async function json(url, options = {}) {
    const result = await fetcher(url, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (result.status === 404) return null;
    if (!result.ok) throw Error("UPSTREAM_UNAVAILABLE");
    return result.json();
  }
  async function load(token) {
    const ledger = await json(
      giving + "/api/giving/railgun/status?address=" + token,
    );
    const batch = firstReceipt(ledger, token);
    if (!batch) return null;
    const rpc = await json(api + "/api/rpc/bsc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getTransactionByHash",
        params: [ledger.creation],
      }),
    });
    const tx = rpc?.result;
    if (
      tx?.hash?.toLowerCase() !== ledger.creation.toLowerCase() ||
      tx.to?.toLowerCase() !== portal
    )
      throw Error("LAUNCH_UNAVAILABLE");
    const [args] = iface.decodeFunctionData("newTokenV6", tx.input);
    const symbol =
      args.symbol
        .replace(/[\p{C}]/gu, "")
        .trim()
        .slice(0, 16) || token.slice(0, 10);
    return {
      token,
      symbol,
      net: batch.net,
      hash: batch.hash,
      block: batch.block,
      cid: args.meta,
    };
  }
  async function get(key, fn) {
    if (cache.has(key)) return cache.get(key);
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= 12) throw Error("BUSY");
    const work = fn()
      .then((value) => {
        if (value) {
          if (cache.size >= 48) cache.delete(cache.keys().next().value);
          cache.set(key, value);
        }
        return value;
      })
      .finally(() => pending.delete(key));
    pending.set(key, work);
    return work;
  }
  async function image(card) {
    if (
      !/^(?:baf[yk][a-z2-7]{20,120}|Qm[1-9A-HJ-NP-Za-km-z]{44})$/.test(card.cid)
    )
      throw Error("INVALID_METADATA");
    const metadata = await json(api + "/api/metadata/" + card.cid);
    const url = publicUrl(metadata?.image);
    if (!url.startsWith("https://flap.mypinata.cloud/ipfs/"))
      throw Error("INVALID_ART_URL");
    const art = await fetcher(url, {
      redirect: "error",
      signal: AbortSignal.timeout(9000),
    });
    return receiptPng(card, await readArtwork(art));
  }
  return async function serve({ token, image: wantImage }, req, res) {
    const send = (status, type, bytes, cacheControl) => {
      res.writeHead(status, {
        "Content-Type": type,
        "Cache-Control": cacheControl,
        "X-Content-Type-Options": "nosniff",
      });
      res.end(req.method === "HEAD" ? undefined : bytes);
    };
    try {
      const card = await get(token, () => load(token));
      if (wantImage) {
        if (!card)
          return send(
            404,
            "text/plain",
            "Confirmed receipt unavailable",
            "no-store",
          );
        const png = await get(token + "/png", () => image(card));
        return send(200, "image/png", png, "public, max-age=86400");
      }
      const html = await readIndex(req.url);
      send(
        200,
        "text/html; charset=utf-8",
        card
          ? html.replace("</head>", () => previewTags(card) + "\n</head>")
          : html,
        "no-store",
      );
    } catch {
      if (!wantImage) {
        try {
          return send(
            200,
            "text/html; charset=utf-8",
            await readIndex(req.url),
            "no-store",
          );
        } catch {}
      }
      send(503, "text/plain", "Receipt temporarily unavailable", "no-store");
    }
  };
}
