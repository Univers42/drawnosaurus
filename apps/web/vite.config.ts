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
const realtimeTarget = process.env.REALTIME_PROXY_TARGET ?? "http://127.0.0.1:4402";

/**
 * Watch by polling instead of by inotify.
 *
 * The dev server runs in a container against a bind-mounted working copy, and this
 * checkout lives on a network filesystem. inotify events do not cross either boundary
 * reliably, so Vite never learns a file changed: it keeps serving whatever it compiled
 * at startup and looks, from the browser, exactly like code that was never written.
 * That failure is silent and survives every rebuild, which makes it expensive — you end
 * up doubting the change rather than the watcher.
 *
 * Polling costs a little CPU, so it is opt-in and `make dev` opts in. Running Vite
 * directly on a local disk needs none of it.
 */
const usePolling = process.env.VITE_USE_POLLING === "1";

/**
 * "server" is the Docker build (adapter-node, the API behind the gateway); "browser" is
 * the public build (adapter-static, boards in IndexedDB). It is build input, so a typo
 * must stop the build rather than quietly produce the other one.
 */
const mode = process.env.VITE_HYDRAWN_MODE ?? "server";
if (mode !== "server" && mode !== "browser") {
  throw new Error(`VITE_HYDRAWN_MODE must be "server" or "browser", got "${mode}"`);
}

export default defineConfig({
  // Folded in, so `BROWSER_MODE` (lib/mode.ts) is a constant and the minifier drops the
  // branch that does not apply.
  define: { "import.meta.env.VITE_HYDRAWN_MODE": JSON.stringify(mode) },
  plugins: [sveltekit()],
  server: {
    fs: { allow: [engineSrc, enginePkg] },
    watch: usePolling ? { usePolling: true, interval: 300 } : undefined,
    proxy: {
      // Same-origin in dev so the browser never needs CORS.
      "/v1": { target: apiTarget, changeOrigin: true, ws: true },
      // Live collab gateway (engine/realtime). Used when PUBLIC_REALTIME_WS_URL is unset.
      "/ws": { target: realtimeTarget, changeOrigin: true, ws: true },
    },
  },
  assetsInclude: ["**/*.wasm"],
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Instantiates the engine's WASM for the tests, from its bytes: the app's
    // `loadDrawEngine()` fetches a sibling `.wasm`, which node cannot do. Needed since
    // the front's camera maths became a WASM call rather than a TypeScript mirror.
    setupFiles: ["./test/vitest.setup.ts"],
  },
});
