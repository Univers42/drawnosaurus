import { sveltekit } from "@sveltejs/kit/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The engine alias itself lives in svelte.config.js (kit.alias) so it is declared
 * once for both Vite and tsc. What is still needed here: the engine sits OUTSIDE
 * this project's root, and Vite's dev server refuses to serve files from outside the
 * root unless they are allow-listed — so dev would 403 on the WASM glue without this.
 */
const engineSrc = fileURLToPath(new URL("../../engine/src", import.meta.url));
const enginePkg = fileURLToPath(new URL("../../engine/pkg", import.meta.url));

const apiTarget = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:4000";

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    fs: { allow: [engineSrc, enginePkg] },
    proxy: {
      // Same-origin in dev so the browser never needs CORS.
      "/v1": { target: apiTarget, changeOrigin: true, ws: true },
    },
  },
  assetsInclude: ["**/*.wasm"],
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
