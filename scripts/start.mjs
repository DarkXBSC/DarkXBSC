import { spawn } from "node:child_process";
const processes = [
  spawn(process.execPath, ["scripts/server.mjs"], { stdio: "inherit" }),
  spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      process.env.DARK_WEB_PORT || "5206",
      "--strictPort",
    ],
    { stdio: "inherit" },
  ),
];
let closing = false;
function stop(code = 0) {
  if (closing) return;
  closing = true;
  for (const p of processes) p.kill("SIGTERM");
  process.exitCode = code;
}
for (const p of processes) {
  p.on("exit", (code) => stop(code || 0));
  p.on("error", () => stop(1));
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
