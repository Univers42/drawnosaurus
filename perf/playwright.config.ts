import { defineConfig, devices } from "@playwright/test";

/**
 * The parity benchmark: drawnosaurus against Excalidraw, both on localhost.
 *
 * A separate config from `e2e/` on purpose. This one needs Excalidraw installed and
 * served, takes minutes rather than seconds, and produces a *measurement* rather than a
 * pass or a fail — so it must never be part of the gate that runs on every save.
 * `make parity` runs it; CI does not.
 */

const OURS_PORT = Number(process.env.PERF_OURS_PORT ?? 4374);
const THEIRS_PORT = Number(process.env.PERF_THEIRS_PORT ?? 3010);

export default defineConfig({
  testDir: ".",
  // One at a time, and never retried: two browsers sharing a CPU measure each other.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 300_000,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    // Fixed, because both editors are being asked to fill the same number of pixels.
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  },
  webServer: [
    {
      command: `node node_modules/vite/bin/vite.js dev --host 127.0.0.1 --port ${OURS_PORT} --strictPort`,
      cwd: "../apps/web",
      url: `http://127.0.0.1:${OURS_PORT}`,
      reuseExistingServer: true,
      timeout: 180_000,
    },
    {
      // Their own vite, from their own install, so the comparison is against the app as
      // it ships rather than against a rebuild of it. BROWSER=none because their config
      // sets `server.open`, which would try to launch a browser on the host.
      command: `node ../node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${THEIRS_PORT} --strictPort`,
      cwd: "../third_party/excalidraw/excalidraw-app",
      url: `http://127.0.0.1:${THEIRS_PORT}`,
      env: { BROWSER: "none" },
      reuseExistingServer: true,
      timeout: 300_000,
    },
  ],
});
