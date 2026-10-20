import { expect, test } from "../fixtures.ts";
import { relay } from "../board.ts";
import { openApp } from "./drawing.ts";

/**
 * The board waits for its engine.
 *
 * The engine is a WASM module, and it takes a moment to arrive. Until it does, the canvas
 * cannot answer: a drag on it draws nothing, and a patch from a peer has nowhere to go —
 * `applyRemote` returns when there is no engine. The board was presented anyway, and the
 * live link joined the room while the engine was still loading, so a newcomer's board was
 * dead and everything that arrived in that window was dropped on the floor.
 *
 * The engine's WASM is held here, so the window is as wide as the test needs.
 */

/** How long the engine's WASM is held, so the engine cannot be up in the meantime. */
const WASM_HELD_MS = 8_000;

/** How long the newcomer is given to read the board and do what it would with it. */
const SETTLE_MS = 2_000;

test("a newcomer whose engine is still loading waits: no board to draw on, no room joined", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const live = relay();
  await page.routeWebSocket(/\/ws$/, live.join);
  await openApp(page);
  await page.getByRole("button", { name: "Share & collaborate" }).click();
  await page.getByRole("button", { name: "Share live" }).click();
  const field = page.getByLabel("Share link");
  await expect(field).toBeVisible();
  const link = await field.inputValue();
  await page.getByRole("button", { name: "Close dialog" }).click();

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const theirs = await context.newPage();
  let joined = 0;
  await theirs.routeWebSocket(/\/ws$/, (socket) => {
    joined += 1;
    live.join(socket);
  });
  await theirs.route("**/*.wasm", async (route) => {
    await new Promise((done) => setTimeout(done, WASM_HELD_MS));
    await route.continue();
  });

  await theirs.goto(link);
  await theirs.waitForTimeout(SETTLE_MS);

  // The board is not presented: there is nothing to draw on yet.
  await expect(theirs.locator("canvas")).toHaveCount(0, { timeout: 2_000 });
  // And the room is not joined: a patch that arrived now would have nowhere to go.
  expect(joined, "the live link joined the room before the engine was up").toBe(0);

  // The engine comes up: the board appears, and only then does the room get joined.
  await expect(theirs.locator("canvas").first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => joined).toBe(1);

  await context.close();
});
