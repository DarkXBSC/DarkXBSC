import { readFile } from "node:fs/promises";
import { createReceiptHandler, receiptRoute } from "./market-receipt.mjs";
export default function receiptPreview() {
  const mount = (server, readIndex) => {
    const serve = createReceiptHandler({
      api: "http://127.0.0.1:" + (process.env.DARK_API_PORT || "5207"),
      readIndex,
    });
    server.middlewares.use((req, res, next) => {
      const match = receiptRoute(new URL(req.url, "http://localhost"));
      if (!match || !["GET", "HEAD"].includes(req.method)) return next();
      void serve(match, req, res).catch(next);
    });
  };
  return {
    name: "dark-market-receipt",
    configureServer(server) {
      mount(server, async (url) =>
        server.transformIndexHtml(url, await readFile("index.html", "utf8")),
      );
    },
    configurePreviewServer(server) {
      mount(server, () => readFile("dist/index.html", "utf8"));
    },
  };
}
