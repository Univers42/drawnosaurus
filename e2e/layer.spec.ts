import { expect, test } from "./fixtures.ts";
import { focusBoard, openBoard, pickTool, type Board } from "./board.ts";

/**
 * The static layer, checked in pixels.
 *
 * The painter keeps the static scene in an offscreen canvas and, when only the camera has
 * moved by a whole number of device pixels, blits it shifted and redraws just the strip
 * that came into view. That is worth roughly an order of magnitude on a pan — and it is
 * the kind of optimisation that goes wrong *silently*, leaving pixels on the board from a
 * frame that is no longer true.
 *
 * `ci_scroll.rs` proves the decision is right in the abstract: what invalidates a layer,
 * which strips a shift exposes, which elements touch them. What it cannot check is the
 * thing that matters here — that a scrolled frame and a freshly drawn one are the same
 * picture. That needs a real canvas, so it is checked here, exactly:
 *
 *   pan (scroll path) -> read the canvas -> force a full redraw -> read it again
 *
 * The two must be identical. Not similar, identical: a scroll by whole device pixels is
 * an exact copy, so anything else is a bug rather than a rounding difference.
 */

/** The canvas as a data URL — an exact readout of every pixel. */
function pixels(board: Board): Promise<string> {
  return board.page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) throw new Error("no canvas");
    return canvas.toDataURL();
  });
}

/**
 * Makes the next frame a full redraw without changing the picture.
 *
 * Toggling the grid twice lands back where it started, and each toggle changes the layer
 * key — so the frame that follows is drawn from scratch with exactly the content the
 * scrolled one should have had.
 */
async function forceFullRedraw(board: Board): Promise<void> {
  await board.page.evaluate(async () => {
    const engine = window.__drawEngine!;
    const was = engine.getGrid().enabled;
    engine.setGrid({ enabled: !was });
    await new Promise((done) => requestAnimationFrame(done));
    engine.setGrid({ enabled: was });
    await new Promise((done) => requestAnimationFrame(done));
  });
  await board.page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}

/** Some shapes with pattern fills, which is where the redraw cost and the risk both are. */
async function drawBoard(board: Board): Promise<void> {
  const { page } = board;
  for (const [i, kind] of ["Rectangle", "Ellipse", "Diamond"].entries()) {
    await pickTool(page, kind);
    await page.mouse.move(board.box.x + 470 + i * 200, board.box.y + 200 + i * 60);
    await page.mouse.down();
    await page.mouse.move(board.box.x + 640 + i * 200, board.box.y + 380 + i * 60, { steps: 5 });
    await page.mouse.up();
  }
}

test.describe("the static layer", () => {
  for (const [name, dx, dy] of [
    ["right and down", 20, 30],
    ["left and up", -24, -18],
    ["straight down", 0, 40],
    ["straight across", 35, 0],
  ] as const) {
    test(`a pan ${name} looks the same as a full redraw`, async ({ page }) => {
      const board = await openBoard(page);
      await drawBoard(board);
      await focusBoard(board);

      await page.mouse.move(board.box.x + 700, board.box.y + 400);
      // Negated, because a wheel delta moves the content the other way — so this pans the
      // camera by exactly (dx, dy).
      await page.mouse.wheel(-dx, -dy);
      await page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      );
      const scrolled = await pixels(board);

      await forceFullRedraw(board);
      const redrawn = await pixels(board);

      expect(scrolled, "a scrolled frame differs from a freshly drawn one").toBe(redrawn);
    });
  }

  test("a long run of pans does not drift", async ({ page }) => {
    // Each scroll builds on the last, so an error of one pixel per frame would be
    // invisible once and obvious after thirty. This is the assertion that catches a
    // rounding mistake that only compounds.
    const board = await openBoard(page);
    await drawBoard(board);
    await focusBoard(board);

    await page.mouse.move(board.box.x + 700, board.box.y + 400);
    for (let i = 0; i < 30; i += 1) {
      await page.mouse.wheel(-13, -7);
    }
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    const scrolled = await pixels(board);

    await forceFullRedraw(board);
    expect(scrolled).toBe(await pixels(board));
  });

  test("zooming and panning together still matches", async ({ page }) => {
    // A zoom invalidates the layer outright, so this checks the handover: the frame after
    // a zoom must be drawn fresh, and the pans after it must scroll from *that*.
    const board = await openBoard(page);
    await drawBoard(board);
    await focusBoard(board);

    await page.mouse.move(board.box.x + 700, board.box.y + 400);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");
    for (let i = 0; i < 5; i += 1) {
      await page.mouse.wheel(-11, -9);
    }
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    const scrolled = await pixels(board);

    await forceFullRedraw(board);
    expect(scrolled).toBe(await pixels(board));
  });

  test("editing while panned redraws rather than reusing", async ({ page }) => {
    // The failure the digest exists to prevent: change the picture, and the layer must
    // not survive it.
    const board = await openBoard(page);
    await drawBoard(board);
    await focusBoard(board);
    await page.mouse.move(board.box.x + 700, board.box.y + 400);
    await page.mouse.wheel(-20, -30);

    const before = await pixels(board);
    await pickTool(page, "Rectangle");
    await page.mouse.move(board.box.x + 500, board.box.y + 500);
    await page.mouse.down();
    await page.mouse.move(board.box.x + 620, board.box.y + 590, { steps: 4 });
    await page.mouse.up();
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );

    expect(await pixels(board), "a new shape did not reach the canvas").not.toBe(before);
  });
});
