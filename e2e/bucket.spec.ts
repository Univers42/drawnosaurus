import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  elementKinds,
  openBoard,
  patchedElements,
  pickTool,
  sceneElements,
  type Board,
} from "./board.ts";

/**
 * Bucket fill, through a real browser.
 *
 * The geometry is already settled in the motor — 41 tests in
 * `engine/crates/draw-engine/tests/ci_bucket_fill.rs` cover the boundary graph, the face
 * walk, the island keyholes and the z-order. None of that is retested here. What is here
 * is the half those cannot reach: a click on a canvas, an element in the scene, a patch
 * on the wire, and a shape the renderer can actually build. Every bug this feature has
 * had lived in that gap, which is why a green engine suite said it worked.
 */

/** Corners well inside `OPEN_CANVAS`, so no floating panel eats the gesture. */
const SHAPE = { from: { x: 520, y: 240 }, to: { x: 900, y: 560 } };
const INSIDE = { x: 700, y: 400 };

/** A rectangle drawn by hand, so the fill has a real boundary to find. */
async function drawRectangle(page: Page, board: Board): Promise<void> {
  await pickTool(page, "Rectangle");
  await page.mouse.move(board.box.x + SHAPE.from.x, board.box.y + SHAPE.from.y);
  await page.mouse.down();
  await page.mouse.move(board.box.x + SHAPE.to.x, board.box.y + SHAPE.to.y, { steps: 8 });
  await page.mouse.up();
}

/** One bucket click at a point on the board. */
async function fillAt(page: Page, board: Board, at: { x: number; y: number }): Promise<void> {
  await pickTool(page, "Bucket fill");
  await page.mouse.click(board.box.x + at.x, board.box.y + at.y);
}

test.describe("bucket fill", () => {
  test("a click inside a shape paints it, and paints it once", async ({ page }) => {
    // One click is one fill. A duplicate would stack exactly on the original, invisible
    // until you moved one and found another underneath, and would double the scene on
    // every click after that — so it is worth an assertion even though it holds today.
    const board = await openBoard(page);
    await drawRectangle(page, board);
    expect(await sceneElements(page)).toHaveLength(1);

    await fillAt(page, board, INSIDE);

    expect(await sceneElements(page)).toHaveLength(2);
    // The fill is a closed line, and it goes under the outline it came from rather than
    // over it — paint belongs behind the stroke that bounds it.
    expect(await elementKinds(page)).toEqual(["line", "rectangle"]);
  });

  test("the paint that appears on screen is also sent to the server", async ({ page }) => {
    // The bug that made this feature unusable: the fill existed in the engine and showed
    // on the canvas, but never reached the API, so it was gone on the next load. The
    // engine did all its work inside `begin_pointer` and never reached the `end_pointer`
    // that flushes.
    const board = await openBoard(page);
    await drawRectangle(page, board);

    await fillAt(page, board, INSIDE);

    // The autosaver debounces, so wait for the patch rather than for a duration.
    await expect
      .poll(async () => (await patchedElements(page)).filter((el) => el.type === "line").length, {
        message: "no patch carrying the fill ever reached the API",
        timeout: 10_000,
      })
      .toBeGreaterThan(0);
  });

  test("a click on bare canvas paints nothing", async ({ page }) => {
    // There is no region to fill, and the failure has to be quiet: an error, a marquee or
    // a stray element would all be worse than nothing happening.
    const board = await openBoard(page);
    await drawRectangle(page, board);

    await fillAt(page, board, { x: 1100, y: 620 });

    expect(await sceneElements(page)).toHaveLength(1);
  });

  test("filling the same region twice does not stack paint", async ({ page }) => {
    // Clicking an already-filled region should restyle the fill that is there, not lay a
    // second one on top of it — otherwise a board grows an invisible pile of identical
    // polygons every time someone taps the bucket.
    //
    // This one found a crash rather than a duplicate. The restyle path assigned the raw
    // current fill style, which is hachure by default, and a pattern-filled curve is the
    // one shape rough had no implementation for — so the second click aborted the WASM
    // module and the board stopped responding entirely. Four more clicks here than feels
    // necessary, because the fourth is the one that used to catch it.
    const board = await openBoard(page);
    await drawRectangle(page, board);

    for (let click = 0; click < 4; click += 1) {
      await fillAt(page, board, { x: INSIDE.x - click * 12, y: INSIDE.y + click * 12 });
      expect(await sceneElements(page), `after click ${click + 1}`).toHaveLength(2);
    }
  });
});
