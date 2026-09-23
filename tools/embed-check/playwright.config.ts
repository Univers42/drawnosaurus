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
 */
const root = path.resolve(import.meta.dirname, "../..");
const webServer = base.webServer as { cwd?: string } | undefined;

export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: /.*\.check\.ts$/,
  timeout: 60 * 60_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  ...(webServer ? { webServer: { ...webServer, cwd: path.join(root, "apps/web") } } : {}),
});
