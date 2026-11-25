import { launchChain } from "./launch-chains.mjs";
import { launchMetadata } from "./launch-disclosure.mjs";
import { publicUrl } from "../src/lib/public-url.mjs";
import { hireAPI } from "./hire-api.mjs";
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import { Worker } from "node:worker_threads";
import dotenv from "dotenv";
import { join } from "node:path";
import { givingPath, hostedLedger, signerStatus } from "./x-hosted.mjs";
import { createPeerService } from "./peer-pay.mjs";
import { resolveSquarePost } from "./square-post.mjs";
import { createXTaxGiving } from "./x-tax-giving.mjs";
import { createBinanceGiving } from "./binance-giving.mjs";
import { createGmgnMarket } from "./gmgn-market.mjs";
import { createMarketReader } from "./market.mjs";
import { createPayReader } from "./agent-pay.mjs";
const apiPort = Number(process.env.DARK_API_PORT || 5207),
  webPort = Number(process.env.DARK_WEB_PORT || 5206);
if (
  ![apiPort, webPort].every(
    (x) => Number.isInteger(x) && x >= 1024 && x <= 65535,
  )
)
  throw Error("Invalid local port");
const privateController = process.env.DARK_GIVING_CONTROLLER === "yes";
const configuredEnv = privateController
  ? join(process.env.CREDENTIALS_DIRECTORY, "giving.env")
  : fs.existsSync(".env")
    ? ".env"
    : ".env.example";
const env = Object.fromEntries(
  Object.entries(dotenv.parse(fs.readFileSync(configuredEnv, "utf8"))).filter(
    ([k]) =>
      [
        "BSC_RPC_URL",
        "ROBINHOOD_RPC_URL",
        "GMGN_API_KEY",
        "X_API_BEARER_TOKEN",
        "RELAY_API_KEY",
        "X_TAX_SEED",
        "X_TAX_HOSTED",
        "X_TAX_IDENTITY_API",
        "X_TAX_BRIDGE_API",
        "X_TAX_MIN_USDT",
        "X_TAX_BSC_RPC_URL",
        "X_TAX_MAX_USDT",
        "X_TAX_ENABLE",
        "X_TAX_AUTO_NATIVE",
        "X_TAX_GAS_SPONSOR",
        "X_TAX_GAS_LIMIT_BNB",
        "X_TAX_GAS_LIMIT_ETH",
        "BASE_RPC_URL",
        "BINANCE_PAY_KEY",
        "BINANCE_PAY_SECRET",
        "GIVING_COLLECTION_XPUB",
        "GIVING_STORE_KEY",
        "GIVING_PAYOUT_MAX_USDT",
      ].includes(k),
  ),
);
env.ROBINHOOD_RPC_URL ||= "https://rpc.mainnet.chain.robinhood.com";
env.BASE_RPC_URL ||= "https://mainnet.base.org";
const protocol = JSON.parse(fs.readFileSync("public/protocols.json"));
const gmgn = createGmgnMarket(env.GMGN_API_KEY);
const remoteGiving = env.X_TAX_HOSTED === "yes" && !privateController;
const xGiving = remoteGiving
  ? { enabled: false }
  : createXTaxGiving(
      env,
      privateController ? { dir: hostedLedger, sharedLedger: true } : {},
    );
const sponsorEnabled = env.X_TAX_GAS_SPONSOR === "deployer" && xGiving.enabled;
let sponsorReady = false;
let settlementWorker;
function sponsorAvailable() {
  if (!privateController) return sponsorReady;
  try {
    const { ready, at } = JSON.parse(fs.readFileSync(signerStatus, "utf8"));
    const age = Date.now() - at;
    return ready === true && age >= 0 && age < 120000;
  } catch {
    return false;
  }
}
const settlementActive = () =>
  xGiving.enabled && (!sponsorEnabled || sponsorAvailable());
function startSponsoredSettlement() {
  if (!server.listening) return;
  const workerData = Object.fromEntries(
    Object.entries(env).filter(
      ([k]) =>
        k.startsWith("X_TAX_") ||
        ["BASE_RPC_URL", "ROBINHOOD_RPC_URL", "RELAY_API_KEY", "X_API_BEARER_TOKEN"].includes(k),
    ),
  );
  settlementWorker = new Worker(
    new URL("./x-tax-worker.mjs", import.meta.url),
    { workerData, env: {} },
  );
  settlementWorker.on("message", (ready) => {
    sponsorReady = ready === true;
  });
  settlementWorker.on("error", () => {
    sponsorReady = false;
    console.error("X tax gas worker unavailable");
  });
  settlementWorker.on("exit", () => {
    sponsorReady = false;
    if (server.listening) setTimeout(startSponsoredSettlement, 15000).unref();
  });
}
if (xGiving.enabled && !sponsorEnabled && !privateController)
  setInterval(() => xGiving.tick().catch(() => {}), 15000).unref();
const binanceGiving = createBinanceGiving(env);
if (binanceGiving.enabled)
  setInterval(() => binanceGiving.tick().catch(() => {}), 15000).unref();
const marketReader = createMarketReader();
const payReader = createPayReader({ bscRpc: env.BSC_RPC_URL });
const siteOrigin =
  process.env.DARK_PUBLIC_ORIGIN || `http://127.0.0.1:${webPort}`;
if (
  process.env.DARK_PUBLIC_ORIGIN &&
  (new URL(siteOrigin).protocol !== "https:" ||
    new URL(siteOrigin).origin !== siteOrigin)
)
  throw Error("Invalid public site origin");
const peerService = createPeerService({
  identity: (address) => payReader.identity(address),
  origin: siteOrigin,
});
const allowedOrigins = new Set([
  siteOrigin,
  `http://127.0.0.1:${webPort}`,
  `http://localhost:${webPort}`,
  `http://127.0.0.1:${apiPort}`,
]);
const allowedMethods = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_getCode",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getBlockByNumber",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getLogs",
]);
let mining = false,
  quotesCache = null;
const json = (res, status, body) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(body));
};
async function body(req, max = 3_500_000) {
  let size = 0,
    chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > max) throw Error("Request too large");
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
async function publicJSON(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          "User-Agent": "DarkGenesis/1.0",
          Accept: "application/json",
        },
      },
      (response) => {
        let data = "";
        response.on("data", (chunk) => {
          data += chunk;
          if (data.length > 1000000) {
            request.destroy();
            reject(Error("Response too large"));
          }
        });
        response.on("end", () => {
          try {
            if (response.statusCode !== 200) throw Error("HTTP failure");
            resolve(JSON.parse(data));
          } catch {
            reject(Error("Invalid upstream response"));
          }
        });
      },
    );
    request.setTimeout(15000, () => request.destroy(Error("Timeout")));
    request.on("error", reject);
  });
}
const hire = privateController ? null : hireAPI(env, siteOrigin);
const server = http.createServer(async (req, res) => {
  try {
    if (
      ![
        `127.0.0.1:${apiPort}`,
        `localhost:${apiPort}`,
        `127.0.0.1:${webPort}`,
        `localhost:${webPort}`,
      ].includes(req.headers.host) ||
      (req.headers.origin && !allowedOrigins.has(req.headers.origin))
    )
      return json(res, 403, { error: "LOCAL_ORIGIN_REQUIRED" });
    const u = new URL(req.url, "http://127.0.0.1:5207");
    if (privateController && !givingPath(u.pathname))
      return json(res, 404, { error: "NOT_FOUND" });
    if (hire && u.pathname.startsWith("/api/hire/")) return hire(req,res,u,{json,body,allowedOrigins});
    if (remoteGiving && givingPath(u.pathname)) {
      if (!["GET", "POST"].includes(req.method))
        return json(res, 405, { error: "METHOD_NOT_ALLOWED" });
      if (
        req.method === "POST" &&
        (!allowedOrigins.has(req.headers.origin) ||
          !req.headers["content-type"]?.startsWith("application/json"))
      )
        return json(res, 403, { error: "LOCAL_ORIGIN_REQUIRED" });
      const upstream = await fetch(
        "https://darkwork.fun" + u.pathname + u.search,
        {
          method: req.method,
          redirect: "error",
          signal: AbortSignal.timeout(60000),
          headers: {
            "Content-Type": "application/json",
            Origin: "https://darkwork.fun",
          },
          ...(req.method === "POST" ? { body: await body(req, u.pathname === "/api/giving/x/bind" ? 30000 : 4000) } : {}),
        },
      );
      return json(res, upstream.status, await upstream.json());
    }
    if (u.pathname.startsWith("/api/giving/")) {
      if (req.method === "GET" && u.pathname === "/api/giving/capabilities")
        return json(res, 200, {
          uid: binanceGiving.enabled,
          railgunTax: settlementActive() && sponsorEnabled && sponsorAvailable() && env.X_TAX_AUTO_NATIVE === "yes",
          xTax: settlementActive(),
          xPoolConversion: sponsorEnabled && sponsorAvailable(),
          xGasSponsored: sponsorEnabled && sponsorAvailable(),
          xMax: xGiving.maximum,
          xCheck: xGiving.canCheck === true,
          xIdentityProvider: xGiving.identityProvider,
          xMin: xGiving.minimum,
          chains: xGiving.ponsEnabled && sponsorAvailable() ? [56, 8453, 4663] : [56, 8453],
          xAutoNative: env.X_TAX_AUTO_NATIVE === "yes" && sponsorEnabled && sponsorAvailable(),
        });
      if (
        u.pathname === "/api/giving/nominations" ||
        u.pathname.startsWith("/api/giving/nominations/")
      ) {
        const book = xGiving.nominations;
        if (!book) return json(res, 503, { error: "X_TAX_UNAVAILABLE" });
        const path = u.pathname.slice("/api/giving/nominations".length);
        try {
          if (req.method === "GET" && !path)
            return json(
              res,
              200,
              book.list(
                Number(u.searchParams.get("before") || 0),
                u.searchParams.get("owner") || "",
              ),
            );
          if (req.method === "GET" && /^\/[a-f0-9-]{36}$/.test(path))
            return json(res, 200, book.detail(path.slice(1)));
          if (req.method !== "POST")
            return json(res, 404, { error: "NOMINATION_NOT_FOUND" });
          if (
            !allowedOrigins.has(req.headers.origin) ||
            !req.headers["content-type"]?.startsWith("application/json")
          )
            return json(res, 403, { error: "LOCAL_ORIGIN_REQUIRED" });
          const input = JSON.parse((await body(req, 4000)).toString());
          if (path === "/challenge")
            return json(res, 200, book.challenge(input, req.headers.origin));
          if (path === "/publish")
            return json(
              res,
              200,
              await book.publish(input, payReader.identity),
            );
          return json(res, 404, { error: "NOMINATION_NOT_FOUND" });
        } catch (e) {
          const codes = [
            "INVALID_NOMINATION",
            "NOMINATION_NOT_FOUND",
            "INVALID_SIGNATURE",
            "AGENT_ID_REQUIRED",
            "CHALLENGE_EXPIRED",
            "X_ACCOUNT_UNVERIFIED",
            "TOO_MANY_REQUESTS",
          ];
          return json(res, e.message === "NOMINATION_NOT_FOUND" ? 404 : 422, {
            error: codes.includes(e.message)
              ? e.message
              : "NOMINATION_UNAVAILABLE",
          });
        }
      }
      if (u.pathname.startsWith("/api/giving/railgun/")) {
        const book=xGiving.railTax;
        if(!book)return json(res,503,{error:"SETTLEMENT_UNAVAILABLE"});
        if (req.method==="GET" && u.pathname==="/api/giving/railgun/launches") {
          try {return json(res,200,await book.launches(u.searchParams.get("before"),publicJSON));}
          catch(e){return json(res,e.message==="INVALID_CURSOR"?400:503,{error:e.message==="INVALID_CURSOR"?"INVALID_CURSOR":"DIRECTORY_UNAVAILABLE"});}
        }
        try {
          if(req.method==="GET" && u.pathname==="/api/giving/railgun/status"){
            const data=book.status(u.searchParams.get("address"));
            return json(res,data?200:404,data||{error:"UNKNOWN_ROUTE"});
          }
          if(req.method!=="POST" || !allowedOrigins.has(req.headers.origin) || !req.headers["content-type"]?.startsWith("application/json"))return json(res,403,{error:"LOCAL_ORIGIN_REQUIRED"});
          if(!settlementActive() || !sponsorEnabled || !sponsorAvailable() || env.X_TAX_AUTO_NATIVE!=="yes")return json(res,503,{error:"SETTLEMENT_UNAVAILABLE"});
          const input=JSON.parse((await body(req,2000)).toString());
          if(u.pathname==="/api/giving/railgun/check")return json(res,200,book.check(input));
          if(u.pathname==="/api/giving/railgun/bind")return json(res,200,await book.bind(input));
          return json(res,404,{error:"UNKNOWN_ROUTE"});
        } catch(e){return json(res,422,{error:["INVALID_RAILGUN_ADDRESS","RAILGUN_ADDRESS_NETWORK","INVALID_SHARE","INVALID_FLAP_SALT","SALT_ALREADY_USED","RAIL_POOL_UNSUPPORTED","RECIPIENT_CHANGED"].includes(e.message)?e.message:"RAIL_REQUEST_FAILED"});}
      }
      if (u.pathname.startsWith("/api/giving/x/")) {
        if (
          !xGiving.canCheck ||
          (!settlementActive() && u.pathname === "/api/giving/x/bind")
        )
          return json(res, 503, { error: "X_TAX_UNAVAILABLE" });
        try {
          if (req.method === "GET" && u.pathname === "/api/giving/x/status") {
            const address = u.searchParams.get("address");
            if (!/^0x[a-f0-9]{40}$/i.test(address ?? ""))
              return json(res, 422, { error: "INVALID_ADDRESS" });
            const result = xGiving.status(address, Number(u.searchParams.get("chainId") || 56));
            return json(
              res,
              result ? 200 : 404,
              result || { error: "UNKNOWN_ROUTE" },
            );
          }
          if (
            req.method !== "POST" ||
            !allowedOrigins.has(req.headers.origin) ||
            !req.headers["content-type"]?.startsWith("application/json")
          )
            return json(res, 403, { error: "LOCAL_ORIGIN_REQUIRED" });
          const input = JSON.parse((await body(req, u.pathname === "/api/giving/x/bind" ? 30000 : 1500)).toString());
          if (u.pathname === "/api/giving/x/check") {
            const result = await xGiving.check(
              input.recipient,
              input.nomination,
              input.disclosure,
              input.beneficiaryKey,
              input.chainId,
            );
            if (!settlementActive()) {
              result.state = "VERIFIED";
              delete result.ticket;
            }
            return json(res, 200, result);
          }
          if (u.pathname === "/api/giving/x/bind")
            return json(res, 200, await xGiving.bind(input));
          return json(res, 404, { error: "UNKNOWN_ROUTE" });
        } catch (e) {
          return json(res, 422, {
            error: [
              "UNSUPPORTED_LAUNCH_CHAIN",
              "NOMINATION_NOT_FOUND",
              "INVALID_DISCLOSURE",
              "PRIVATE_NOMINATION_REQUIRED",
              "PRIVATE_RECIPIENT_IN_PUBLIC_CONTENT",
              "X_POOL_UNAVAILABLE",
              "X_POOL_CONVERSION_UNAVAILABLE",
              "INVALID_X_HANDLE",
              "X_ACCOUNT_UNVERIFIED",
              "X_LOOKUP_UNAVAILABLE",
              "X_QUOTE_UNAVAILABLE",
              "RECIPIENT_CHANGED",
            ].includes(e.message)
              ? e.message
              : "X_TAX_CHECK_FAILED",
          });
        }
      }
      if (
        u.pathname === "/api/giving/square-post" &&
        req.method === "POST" &&
        allowedOrigins.has(req.headers.origin) &&
        req.headers["content-type"]?.startsWith("application/json")
      ) {
        try {
          const { post, declarationOnly } = JSON.parse(
            (await body(req, 1500)).toString(),
          );
          return json(
            res,
            200,
            await resolveSquarePost(post, {
              declarationOnly: declarationOnly === true,
            }),
          );
        } catch (e) {
          return json(res, 422, {
            error: ["INVALID_RECIPIENT", "POST_PAYOUT_NOT_BOUND"].includes(
              e.message,
            )
              ? e.message
              : "POST_AUTHOR_UNVERIFIED",
          });
        }
      }
      if (["/api/giving/recipient", "/api/giving/bind"].includes(u.pathname)) {
        if (
          req.method !== "POST" ||
          !allowedOrigins.has(req.headers.origin) ||
          !req.headers["content-type"]?.startsWith("application/json")
        )
          return json(res, 403, { error: "LOCAL_ORIGIN_REQUIRED" });
        try {
          const { recipient, ticket } = JSON.parse(
            (await body(req, 1500)).toString(),
          );
          if (u.pathname === "/api/giving/recipient")
            return json(res, 200, await binanceGiving.check(recipient));
          if (!binanceGiving.enabled)
            return json(res, 503, { error: "MERCHANT_UNAVAILABLE" });
          if (typeof ticket !== "string" || !/^[a-f0-9]{64}$/.test(ticket))
            return json(res, 422, { error: "RECIPIENT_CHANGED" });
          return json(res, 200, await binanceGiving.bind(recipient, ticket));
        } catch (e) {
          return json(res, 422, {
            error: [
              "INVALID_RECIPIENT",
              "POST_AUTHOR_UNVERIFIED",
              "POST_NOT_LINKED",
              "RECIPIENT_CHANGED",
              "UID_NOT_VALIDATED",
            ].includes(e.message)
              ? e.message
              : "MERCHANT_CHECK_FAILED",
          });
        }
      }
      if (!binanceGiving.enabled)
        return json(res, 503, { error: "MERCHANT_UNAVAILABLE" });
      if (
        req.method === "GET" &&
        u.pathname === "/api/giving/status" &&
        /^0x[0-9a-f]{40}$/i.test(u.searchParams.get("address") || "")
      ) {
        const result = binanceGiving.status(u.searchParams.get("address"));
        return json(
          res,
          result ? 200 : 404,
          result || { error: "UNKNOWN_ROUTE" },
        );
      }
      return json(res, 404, { error: "UNKNOWN_ROUTE" });
    }
    if (u.pathname.startsWith("/api/peer/")) {
      try {
        const action = u.pathname.slice(10),
          input =
            req.method === "POST"
              ? JSON.parse((await body(req, 16000)).toString())
              : {},
          token = String(req.headers.authorization || "").replace(
            /^Bearer /,
            "",
          );
        if (req.method === "GET" && action === "capabilities")
          return json(res, 200, peerService.capabilities());
        if (req.method === "POST" && action === "estimate")
          return json(res, 200, await peerService.estimate(input));
        if (req.method === "POST" && action === "challenge")
          return json(res, 200, peerService.challenge(input.address));
        if (req.method === "POST" && action === "authenticate")
          return json(res, 200, await peerService.authenticate(input));
        if (req.method === "POST" && action === "prepare")
          return json(res, 200, await peerService.prepare(input, token));
        if (req.method === "POST" && action === "withdraw")
          return json(
            res,
            200,
            await peerService.withdraw(input.depositId, token),
          );
        if (req.method === "GET" && action === "orders")
          return json(
            res,
            200,
            await peerService.orders(u.searchParams.get("owner")),
          );
        if (req.method === "GET" && action === "order")
          return json(
            res,
            200,
            await peerService.order(u.searchParams.get("id")),
          );
        if (req.method === "GET" && action === "receipt")
          return json(
            res,
            200,
            await peerService.receipt(u.searchParams.get("hash")),
          );
        return json(res, 404, { error: "NO_SERVER_BROADCAST_ENDPOINT" });
      } catch (e) {
        const code =
          typeof e.code === "string" && /^[A-Z_]{3,80}$/.test(e.code)
            ? e.code
            : /^[A-Z_]{3,80}$/.test(e.message)
              ? e.message
              : "PEER_UNAVAILABLE";
        return json(
          res,
          /REQUIRED|SIGNATURE|EXPIRED|MISMATCH/.test(code) ? 403 : 400,
          { error: code },
        );
      }
    }
    if (
      req.method === "GET" &&
      ["/api/market/board", "/api/market/candles"].includes(u.pathname)
    ) {
      try {
        const data = u.pathname.endsWith("/board")
          ? await gmgn.board(u.searchParams.get("chain") || "bsc")
          : await gmgn.candles(
              u.searchParams.get("address"),
              u.searchParams.get("period"),
              u.searchParams.get("chain") || "bsc",
            );
        return json(res, 200, data);
      } catch (e) {
        const code = [
          "INVALID_CHART",
          "GMGN_NOT_CONFIGURED",
          "GMGN_BUSY",
        ].includes(e.message)
          ? e.message
          : "GMGN_UNAVAILABLE";
        return json(
          res,
          code === "INVALID_CHART" ? 400 : code === "GMGN_BUSY" ? 429 : 503,
          { error: code },
        );
      }
    }
    if (req.method === "GET" && u.pathname === "/api/market") {
      try {
        return json(
          res,
          200,
          await marketReader(u.searchParams.get("query") || "flap", u.searchParams.get("chain") || "bsc"),
        );
      } catch {
        return json(res, 502, { error: "MARKET_UNAVAILABLE" });
      }
    }
    if (u.pathname.startsWith("/api/agent-pay/")) {
      try {
        if (req.method === "GET" && u.pathname === "/api/agent-pay/identity")
          return json(
            res,
            200,
            await payReader.identity(u.searchParams.get("address") || ""),
          );
        if (req.method === "GET" && u.pathname === "/api/agent-pay/destination")
          return json(res, 200, await payReader.destination());
        if (req.method === "POST" && u.pathname === "/api/agent-pay/quote")
          return json(
            res,
            200,
            await payReader.quote(
              JSON.parse((await body(req, 4000)).toString()),
            ),
          );
        return json(res, 404, { error: "PREVIEW_ONLY_NO_EXECUTION_ENDPOINT" });
      } catch (error) {
        const safe = [
          "INVALID_ADDRESS",
          "INVALID_AMOUNT",
          "UNSUPPORTED_SOURCE_ASSET",
          "WRONG_RPC_CHAIN",
          "REGISTRY_NOT_FOUND",
          "USDC_IDENTITY_MISMATCH",
          "QUOTE_IDENTITY_MISMATCH",
          "RPC_UNAVAILABLE",
          "UPSTREAM_UNAVAILABLE",
        ];
        const code = safe.includes(error.message)
          ? error.message
          : "PAY_READER_UNAVAILABLE";
        return json(
          res,
          code.startsWith("INVALID_") || code === "UNSUPPORTED_SOURCE_ASSET"
            ? 400
            : 502,
          { error: code },
        );
      }
    }
    if (req.method === "GET" && u.pathname === "/api/config")
      return json(res, 200, {
        ...JSON.parse(fs.readFileSync("public/deployments.json")),
        protocols: protocol,
        uploadProvider: "Flap IPFS",
      });
    if (req.method === "GET" && u.pathname === "/api/flap/quotes") {
      if (quotesCache && Date.now() - quotesCache.at < 60000)
        return json(res, 200, quotesCache.data);
      const data = await publicJSON("https://flap.sh/api/launch/quote-tokens");
      quotesCache = { at: Date.now(), data };
      return json(res, 200, data);
    }
    if (req.method === "GET" && u.pathname.startsWith("/api/metadata/")) {
      const cid = u.pathname.slice("/api/metadata/".length);
      if (
        !/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z2-7]+|bafk[a-z2-7]+)$/.test(cid)
      )
        return json(res, 400, { error: "INVALID_CID" });
      const metadata = await publicJSON("https://flap.mypinata.cloud/ipfs/" + cid);
      // Keep already-open clients working when Flap returns a bare image CID.
      return json(res, 200, { ...metadata, image: publicUrl(metadata.image) });
    }
    if (req.method === "GET" && u.pathname.startsWith("/api/quote-logo/")) {
      const match = u.pathname.match(
        /^\/api\/quote-logo\/(56|4663|8453)\/(0x[\da-fA-F]{40})$/,
      );
      if (!match) return json(res, 400, { error: "INVALID_ASSET" });
      if (!quotesCache || Date.now() - quotesCache.at > 60000)
        quotesCache = {
          at: Date.now(),
          data: await publicJSON("https://flap.sh/api/launch/quote-tokens"),
        };
      const quote = quotesCache.data.chains
        .find((c) => c.chainId === Number(match[1]))
        ?.quoteTokens.find(
          (q) => q.address.toLowerCase() === match[2].toLowerCase(),
        );
      if (!quote) return json(res, 404, { error: "ASSET_NOT_IN_DIRECTORY" });
      const source = new URL(quote.logoUrl, "https://flap.sh");
      if (source.protocol !== "https:" || source.hostname !== "flap.sh")
        return json(res, 400, { error: "UNSUPPORTED_IMAGE_HOST" });
      const image = await new Promise((resolve, reject) => {
        const request = https.get(
          source,
          { headers: { "User-Agent": "DarkGenesis/1.0" } },
          (response) => {
            let size = 0,
              chunks = [];
            response.on("data", (c) => {
              size += c.length;
              if (size > 1000000) request.destroy(Error("Image too large"));
              else chunks.push(c);
            });
            response.on("end", () => {
              const type = response.headers["content-type"]?.split(";")[0];
              if (
                response.statusCode !== 200 ||
                ![
                  "image/svg+xml",
                  "image/png",
                  "image/webp",
                  "image/jpeg",
                ].includes(type)
              )
                return reject(Error("Image unavailable"));
              resolve({ type, bytes: Buffer.concat(chunks) });
            });
          },
        );
        request.setTimeout(15000, () => request.destroy(Error("Timeout")));
        request.on("error", reject);
      });
      res.writeHead(200, {
        "Content-Type": image.type,
        "Cache-Control": "public, max-age=300",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff",
      });
      return res.end(image.bytes);
    }
    if (req.method === "POST" && u.pathname === "/api/flap/salt") {
      if (mining) return json(res, 429, { error: "SALT_MINING_BUSY" });
      const b = JSON.parse((await body(req, 2000)).toString());
      const taxed = b.taxed !== false;
      let network;
      try { network = launchChain(b.chainId ?? 56); } catch { return json(res, 422, {error:"UNSUPPORTED_LAUNCH_CHAIN"}); }
      if (!taxed && !network.standardImplementation) return json(res, 422, {error:"ZERO_TAX_UNAVAILABLE"});
      mining = true;
      const worker = new Worker(new URL("./mine-salt.mjs", import.meta.url), {
        workerData: {
          implementation: taxed
            ? network.taxImplementation
            : network.standardImplementation,
          portal: network.portal,
          suffix: taxed ? "7777" : "8888",
        },
      });
      const timer = setTimeout(() => worker.terminate(), 45000);
      worker.on("message", (v) => json(res, 200, v));
      worker.on("error", () => {
        if (!res.writableEnded) json(res, 500, { error: "SALT_MINING_FAILED" });
      });
      worker.on("exit", () => {
        clearTimeout(timer);
        mining = false;
        if (!res.writableEnded)
          json(res, 504, { error: "SALT_MINING_TIMEOUT" });
      });
      return;
    }
    if (req.method === "POST" && u.pathname === "/api/upload") {
      const data = await body(req);
      const form = await new Request("http://localhost/upload", {
        method: "POST",
        headers: { "Content-Type": req.headers["content-type"] || "" },
        body: data,
      }).formData();
      const file = form.get("image");
      if (
        !(file instanceof File) ||
        file.size === 0 ||
        file.size > 2_500_000 ||
        !["image/png", "image/jpeg", "image/webp"].includes(file.type)
      )
        return json(res, 400, { error: "IMAGE_SIZE_OR_FORMAT" });
      const raw = Buffer.from(await file.arrayBuffer());
      const valid =
        file.type === "image/png"
          ? raw
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : file.type === "image/jpeg"
            ? raw[0] === 255 && raw[1] === 216 && raw[2] === 255
            : raw.toString("ascii", 0, 4) === "RIFF" &&
              raw.toString("ascii", 8, 12) === "WEBP";
      if (!valid) return json(res, 400, { error: "INVALID_IMAGE_CONTENT" });
      let metadata;
      try {
        metadata = launchMetadata({
          creator: form.get("creator"),
          description: form.get("description"),
          website: form.get("website"),
          twitter: form.get("twitter"),
          name: form.get("name"),
          symbol: form.get("symbol"),
          recipient: form.get("recipient"),
          nomination: form.get("nomination"),
          disclosure: form.get("disclosure") ? JSON.parse(String(form.get("disclosure"))) : undefined,
        });
      } catch (error) {
        return json(res, 422, { error: [
          "INVALID_CREATOR", "INVALID_DISCLOSURE", "INVALID_X_HANDLE",
          "PRIVATE_RECIPIENT_IN_PUBLIC_CONTENT", "PRIVATE_NOMINATION_REQUIRED",
          "DESCRIPTION_TOO_LONG",
        ].includes(error.message) ? error.message : "INVALID_DISCLOSURE" });
      }
      const upstream = new FormData();
      upstream.set(
        "operations",
        JSON.stringify({
          query:
            "mutation Create($file: Upload!, $meta: MetadataInput!) { create(file: $file, meta: $meta) }",
          variables: { file: null, meta: metadata },
        }),
      );
      upstream.set("map", JSON.stringify({ 0: ["variables.file"] }));
      upstream.set("0", file);
      const encoded = new Request("https://funcs.flap.sh/api/upload", {
        method: "POST",
        body: upstream,
      });
      const bytes = Buffer.from(await encoded.arrayBuffer());
      const { status, result } = await new Promise((resolve, reject) => {
        const request = https.request(
          encoded.url,
          {
            method: "POST",
            headers: {
              "User-Agent": "DarkGenesis/1.0",
              "Content-Type": encoded.headers.get("content-type"),
              "Content-Length": bytes.length,
            },
          },
          (response) => {
            let text = "";
            response.on("data", (chunk) => {
              text += chunk;
              if (text.length > 1000000)
                request.destroy(Error("Response too large"));
            });
            response.on("end", () => {
              try {
                resolve({
                  status: response.statusCode,
                  result: JSON.parse(text),
                });
              } catch {
                reject(Error("Upload unavailable"));
              }
            });
          },
        );
        request.setTimeout(45000, () =>
          request.destroy(Error("Upload timeout")),
        );
        request.on("error", reject);
        request.end(bytes);
      });
      const cid = result.data?.create;
      if (
        status !== 200 ||
        typeof cid !== "string" ||
        !/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z2-7]+|bafk[a-z2-7]+)$/.test(cid)
      )
        throw Error("Upload service rejected the image");
      return json(res, 200, {
        cid,
        metadataURI: "ipfs://" + cid,
        gateway: "https://flap.mypinata.cloud/ipfs/" + cid,
      });
    }
    if (req.method === "POST" && u.pathname.startsWith("/api/rpc/")) {
      const chain = u.pathname.split("/").pop(),
        url = env[chain?.toUpperCase() + "_RPC_URL"];
      if (!["bsc", "robinhood", "base"].includes(chain) || !url)
        return json(res, 404, { error: "UNKNOWN_CHAIN" });
      const b = JSON.parse((await body(req, 200000)).toString());
      const calls = Array.isArray(b) ? b : [b];
      if (calls.length > 25 || calls.some((x) => !allowedMethods.has(x.method)))
        return json(res, 403, { error: "READ_ONLY_RPC" });
      for (const x of calls) {
        if (x.method === "eth_getLogs") {
          const f = x.params?.[0];
          if (
            !f?.address ||
            !/^0x[\da-f]+$/i.test(f.fromBlock || "") ||
            !/^0x[\da-f]+$/i.test(f.toBlock || "") ||
            BigInt(f.toBlock) - BigInt(f.fromBlock) > 3000n
          )
            return json(res, 400, { error: "LOG_RANGE_LIMIT" });
        }
      }
      const endpoints = new Set([url]);
      if (chain === "bsc")
        endpoints.add(
          env.X_TAX_BSC_RPC_URL || "https://bsc-rpc.publicnode.com",
        );
      if (chain === "robinhood") endpoints.add("https://rpc.mainnet.chain.robinhood.com");
      if (chain === "base") endpoints.add("https://base-rpc.publicnode.com");
      for (const endpoint of endpoints) {
        try {
          const r = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(b),
            signal: AbortSignal.timeout(9000),
          });
          if (r.ok) return json(res, 200, await r.json());
        } catch {
          /* Try the next read-only endpoint on transport failure. */
        }
      }
      return json(res, 502, { error: "RPC_UNAVAILABLE" });
    }
    json(res, 404, { error: "NOT_FOUND" });
  } catch {
    if (!res.writableEnded)
      json(res, 502, {
        error: "SERVICE_UNAVAILABLE",
        message:
          "The request could not be completed. Retry without changing the transaction.",
      });
  }
});
server.listen(apiPort, "127.0.0.1", () => {
  console.log(`Dark local API: http://127.0.0.1:${apiPort}`);
  if (sponsorEnabled && !privateController) startSponsoredSettlement();
});
server.on("close", () => {
  void settlementWorker?.terminate();
});
process.on("SIGTERM", () => server.close());
