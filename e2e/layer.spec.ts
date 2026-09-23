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
 *
 * While the camera is still moving the painter shows the last picture moved, with only
 * the edges it uncovers painted — an approximation by design, replaced by a full redraw
 * on the first frame after the motion stops. So the exact comparison is made once the
 * camera has settled, which is the picture that stays on screen; what a frame in motion
 * must get right is checked on its own below.
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

/** The 140ms motion tail in `MOTION_MS`, plus room for the frame that follows it. */
const PAST_THE_MOTION_TAIL = 400;

/** Waits until the camera has stopped and the frame after it has been painted. */
async function settle(board: Board): Promise<void> {
  await board.page.waitForTimeout(PAST_THE_MOTION_TAIL);
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
      await settle(board);
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
    await settle(board);
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
    await settle(board);
    const scrolled = await pixels(board);

    await forceFullRedraw(board);
    expect(scrolled).toBe(await pixels(board));
  });

  test("the edge a pan uncovers is drawn while it is still moving", async ({ page }) => {
    // The moved picture does not reach the edge the board is coming in from. Left bare,
    // that edge showed empty paper until the camera stopped — the edge someone is looking
    // at, because it is where they are going.
    const board = await openBoard(page);
    await drawBoard(board);
    await focusBoard(board);
    await page.mouse.move(board.box.x + 700, board.box.y + 400);

    // The rectangle half off the left edge, then settled, so the next pan starts from a
    // picture drawn for where the camera is.
    await page.mouse.wheel(500, 0);
    await settle(board);
    const strip = { left: 0, top: 0, right: 36, bottom: board.box.height };

    // Forty pixels back, so the rectangle's left side comes into view across the strip —
    // and the strip read in the very frame that painted it. A frame is only "in motion"
    // within 140ms of the pan, and a frame here can come later than that, so the pan is
    // dispatched and the frame caught from inside the page, in one task: an `await` back
    // to the test between the two would let the motion expire before anything was read.
    // Tried a few times, because the first frame can still come late.
    const seen = await page.evaluate(async (strip) => {
      const engine = window.__drawEngine!;
      const canvas = document.querySelector("canvas")!;
      const ctx = canvas.getContext("2d")!;
      const box = canvas.getBoundingClientRect();
      const ink = (): number => {
        const w = Math.round(strip.right * (canvas.width / box.width));
        const h = Math.round(strip.bottom * (canvas.height / box.height));
        const { data } = ctx.getImageData(0, 0, w, h);
        const paper = ctx.getImageData(canvas.width - 1, 0, 1, 1).data;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (
            Math.abs(data[i]! - paper[0]!) > 12 ||
            Math.abs(data[i + 1]! - paper[1]!) > 12 ||
            Math.abs(data[i + 2]! - paper[2]!) > 12
          ) {
            count += 1;
          }
        }
        return count / (w * h);
      };
      const frame = () => new Promise((done) => requestAnimationFrame(done));
      const still = async () => {
        while (engine.debugSnapshot().rendering.dirty) await frame();
        await frame();
      };
      const wheel = (deltaX: number) =>
        canvas.dispatchEvent(
          new WheelEvent("wheel", {
            deltaX,
            clientX: box.x + 700,
            clientY: box.y + 400,
            bubbles: true,
            cancelable: true,
          }),
        );

      for (let attempt = 0; attempt < 8; attempt += 1) {
        const before = engine.debugSnapshot().rendering.scrolls;
        wheel(-40);
        // Registered after the engine's own frame callback, so it runs straight after
        // that frame is painted.
        await frame();
        const moved = engine.debugSnapshot().rendering.scrolls > before;
        const moving = ink();
        await still();
        const settled = ink();
        if (moved) return { moving, settled };
        wheel(40);
        await still();
      }
      return null;
    }, strip);

    expect(seen, "no frame was ever painted while the camera moved").not.toBeNull();
    expect(seen!.settled, "nothing came into view, so this proves nothing").toBeGreaterThan(0);
    expect(seen!.moving, "the uncovered edge was left blank while moving").toBeGreaterThan(
      seen!.settled * 0.8,
    );
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
