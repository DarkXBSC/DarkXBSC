import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export default defineConfig({
  plugins: [react()],
  resolve: { alias: [
    { find: /^@railgun-community\/circomlibjs$/, replacement: require.resolve("./src/lib/railgun-poseidon.cjs") },
    { find: /^buffer$/, replacement: require.resolve("buffer/") },
    { find: /^stream$/, replacement: require.resolve("stream-browserify") },
    { find: /^assert$/, replacement: require.resolve("assert/") },
    { find: /^events$/, replacement: require.resolve("events/") },
  ] },
  server: {
    host: "127.0.0.1",
    port: 5206,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.DARK_API_PORT || 5207}`,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 5206,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.DARK_API_PORT || 5207}`,
        changeOrigin: true,
      },
    },
  },
});
