import { givingPath } from "./x-hosted.mjs";
import https from "node:https";
import http from "node:http";
import { createSecureContext } from "node:tls";
import { createReadStream, readFileSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";

const domain = "darkwork.fun",
  names = new Set([domain, "www." + domain]);
const root = await realpath("dist");
const tls = createSecureContext({
  cert: readFileSync("/etc/darkwork/origin.crt"),
  key: readFileSync("/etc/darkwork/origin.key"),
  minVersion: "TLSv1.2",
});
const mime = {
  ".wasm": "application/wasm",
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8",
  ".sol": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".zip": "application/zip",
};
const limited = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of limited) if (v.until <= now) limited.delete(k);
}, 60000).unref();
function allow(ip, upload) {
  const now = Date.now(),
    key = (upload ? "upload/" : "api/") + ip,
    entry = limited.get(key);
  if (!entry || entry.until <= now) {
    if (limited.size >= 30000 && !entry) return false;
    limited.set(key, { until: now + (upload ? 60000 : 10000), count: 1 });
    return true;
  }
  return ++entry.count <= (upload ? 10 : 160);
}
function proxy(req, res, port, hostPort, fallback = false) {
  const headers = { host: "127.0.0.1:" + hostPort };
  for (const k of [
    "content-type",
    "content-length",
    "origin",
    "authorization",
    "accept",
  ])
    if (req.headers[k]) headers[k] = req.headers[k];
  const up = http.request(
    {
      hostname: "127.0.0.1",
      port,
      method: req.method,
      path: req.url,
      headers,
      timeout: 75000,
    },
    (out) => {
      res.writeHead(out.statusCode, {
        "Content-Type": out.headers["content-type"] || "application/json",
        "Cache-Control": "no-store",
      });
      out.on("error", () => res.destroy());
      out.pipe(res);
    },
  );
  up.on("timeout", () => up.destroy());
  up.on("error", () => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (fallback) {
      proxy(req, res, 5367, 5367);
      return;
    }
    res.writeHead(503, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end('{"error":"SERVICE_UNAVAILABLE"}');
  });
  res.once("close", () => {
    if (!res.writableEnded) up.destroy();
  });
  if (req.readableEnded) up.end();
  else req.pipe(up);
}
const server = https.createServer(
  {
    minVersion: "TLSv1.2",
    SNICallback(name, done) {
      if (names.has(name)) done(null, tls);
      else done(new Error("Unknown server name"));
    },
  },
  async (req, res) => {
    function end(status) {
      res.writeHead(status, { "Cache-Control": "no-store" });
      res.end();
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "DENY");
    if (!names.has(req.headers.host) || !names.has(req.socket.servername))
      return end(421);
    if (!req.url?.startsWith("/") || req.url.startsWith("//")) return end(400);
    let path;
    try {
      path = decodeURIComponent(req.url.split("?")[0]);
    } catch {
      return end(400);
    }
    if (
      path.includes("\0") ||
      path.includes("\\") ||
      path.split("/").some((p) => p.startsWith("."))
    )
      return end(404);
    if (req.headers.host !== domain) {
      res.writeHead(308, { Location: "https://" + domain + req.url });
      res.end();
      return;
    }
    if (path.startsWith("/api/")) {
      if (!["GET", "POST"].includes(req.method)) return end(405);
      if (req.headers.origin && req.headers.origin !== "https://" + domain)
        return end(403);
      if (
        !allow(
          req.headers["cf-connecting-ip"] || "loopback",
          path === "/api/upload",
        )
      )
        return end(429);
      if (givingPath(path))
        return proxy(
          req,
          res,
          5371,
          5371,
          path === "/api/giving/capabilities" && req.method === "GET",
        );
      return proxy(req, res, 5367, 5367);
    }
    if (req.method !== "GET" && req.method !== "HEAD") return end(405);
    try {
      const route =
        path === "/" ||
        path === "/about" ||
        path === "/admin" ||
        /^\/app(?:\/[a-z0-9-]+)*\/?$/.test(path);
      const file = await realpath(
        resolve(root, "." + (route ? "/index.html" : path)),
      );
      if (!file.startsWith(root + sep)) return end(404);
      const info = await stat(file);
      if (!info.isFile()) return end(404);
      res.writeHead(200, {
        "Content-Type": mime[extname(file)] || "application/octet-stream",
        "Content-Length": info.size,
        "Cache-Control": path.startsWith("/assets/")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      });
      if (req.method === "HEAD") res.end();
      else
        createReadStream(file)
          .on("error", () => res.destroy())
          .pipe(res);
    } catch {
      end(404);
    }
  },
);
server.requestTimeout = 90000;
server.listen(5366, "127.0.0.1");
