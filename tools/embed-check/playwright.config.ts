import path from "node:path";
import { defineConfig } from "@playwright/test";
import base from "../../playwright.config.ts";

/**
 * The live embed check: real links, real providers, the real network.
 *
 * Everything `e2e/` refuses to be — it depends on YouTube being up and on a tweet not
 * having been deleted — which is exactly why it is kept apart from the suite and never
 * part of a gate. What it answers is the question the suite cannot: does a link someone
 * pastes actually come up playing. Run it when the embed rules change:
 *
 *     PLAYWRIGHT_BROWSERS_PATH=… pnpm exec playwright test -c tools/embed-check
 *
 * Results and a screenshot of every frame go to `test-results/embed-check/`.
 * `EMBED_CHECK_ONLY=youtube,vimeo` checks only those providers.
 */
const root = path.resolve(import.meta.dirname, "../..");

/**
 * Served from `localhost`, not the suite's `127.0.0.1`, unless `E2E_HOST` says otherwise.
 * YouTube refuses label-owned videos — most music — to a page at a bare IP address:
 * "This video is unavailable", for a video that plays from `localhost`, which is where
 * the board is used. From 127.0.0.1 the check reported a fault that no one would see.
 */
const onLocalhost = (value: string): string =>
  process.env.E2E_HOST ? value : value.replaceAll("127.0.0.1", "localhost");

const webServer = base.webServer as { command: string; url: string } | undefined;

export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: /.*\.check\.ts$/,
  timeout: 60 * 60_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: { ...base.use, baseURL: onLocalhost(String(base.use?.baseURL ?? "")) },
  ...(webServer
    ? {
        webServer: {
          ...webServer,
          command: onLocalhost(webServer.command),
          url: onLocalhost(webServer.url),
          cwd: path.join(root, "apps/web"),
        },
      }
    : {}),
});
