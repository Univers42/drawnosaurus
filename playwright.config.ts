import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests. Kept out of `make quality` on purpose: that gate runs on every save and
 * has to stay fast, and a browser is neither.
 *
 * The rule this config exists to enforce is that a browser test is *reproducible* or it
 * is worthless — a suite that goes green on a retry teaches nobody anything and trains
 * everyone to re-run it. So: no retries, one worker, a fixed viewport, and no test here
 * may depend on the API or on Mongo (every spec stubs `/v1/**`). What is left can only
 * fail because the thing it measures changed.
 */

const PORT = Number(process.env.E2E_PORT ?? 4373);
const HOST = process.env.E2E_HOST ?? "127.0.0.1";
const BASE_URL = process.env.E2E_BASE_URL ?? `http://${HOST}:${PORT}`;

/**
 * The dev server, unless `E2E_BASE_URL` says one is already running.
 *
 * Spread rather than set to `undefined`, because `exactOptionalPropertyTypes` treats an
 * explicit `undefined` as a different thing from an absent key — and it is right to:
 * Playwright reads the key's presence.
 */
const webServer = process.env.E2E_BASE_URL
  ? {}
  : {
      webServer: {
        // Vite dev rather than a built preview: the app sets `ssr = false`, so there is
        // no server render to exercise, and the dev build is the one that carries the
        // `import.meta.env.DEV` handle these specs read the camera through.
        //
        // Vite's own bin rather than `pnpm --filter …`: this has to start from a bare
        // shell in CI, from a Makefile target, and from a developer's terminal, and the
        // package manager is on the PATH in only some of those.
        command: `node node_modules/vite/bin/vite.js dev --host ${HOST} --port ${PORT} --strictPort`,
        cwd: "apps/web",
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: "pipe" as const,
        stderr: "pipe" as const,
      },
    };

export default defineConfig({
  testDir: "e2e",
  // Deliberately zero. A retry turns "this is broken" into "this is sometimes broken",
  // which is the same information with the urgency removed.
  retries: 0,
  // One worker: these specs measure input handling, and a browser sharing a CPU with
  // three others handles input differently.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    ...devices["Desktop Chrome"],
    // Fixed so a measurement in screen pixels means the same thing on every machine.
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  ...webServer,
});
