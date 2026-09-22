import { expect, test } from "./fixtures.ts";
import {
  DELTA_LINE,
  DELTA_PAGE,
  DELTA_PIXEL,
  camera,
  dispatchWheelAt,
  openBoard,
  resetCamera,
  wheelAt,
} from "./board.ts";

/**
 * The unit a wheel delta is counted in.
 *
 * `zoom.spec.ts` proves a notch is worth one step. It proves it with Chromium's notch,
 * which is `deltaY: 100, deltaMode: 0` — and that is the only kind of notch that browser
 * can be made to send. Firefox reports a mouse wheel in LINES on Windows and Linux: the
 * same physical notch arrives as `deltaY: 3, deltaMode: 1`.
 *
 * Read without its unit, that notch was worth three pixels. The zoom moved 3% where it
 * should move 10%, and — the worse half — the pan moved the board three pixels where it
 * should move a hundred. Neither is a jump; both are the same gesture doing a fraction of
 * its work, on a browser nothing in this suite was exercising.
 *
 * The reference numbers here are `zoom.spec.ts`'s own, asserted against rather than
 * restated: whatever a pixel notch does, a line notch has to do too.
 */

/** One notch, as each browser family reports it. */
const CHROME_NOTCH_PX = 100;
const FIREFOX_NOTCH_LINES = 3;

test.describe("wheel deltaMode", () => {
  test("a line-mode notch zooms the same as the pixel-mode notch it is", async ({ page }) => {
    const board = await openBoard(page);
    const middle = { x: board.box.width / 2, y: board.box.height / 2 };

    // The reference, through real input: this is the gesture zoom.spec.ts pins at 1.1.
    await wheelAt(board, middle, { y: -CHROME_NOTCH_PX }, { ctrl: true });
    const pixelNotch = (await camera(page)).scale;
    expect(pixelNotch).toBeCloseTo(1.1, 5);

    await resetCamera(page);
    expect((await camera(page)).scale).toBeCloseTo(1, 5);

    // The same notch, as Firefox reports it. Before the fix this landed on 1.03.
    await dispatchWheelAt(
      board,
      middle,
      { y: -FIREFOX_NOTCH_LINES, mode: DELTA_LINE },
      { ctrl: true },
    );

    expect((await camera(page)).scale).toBeCloseTo(pixelNotch, 5);
  });

  test("a line-mode wheel pans by a notch rather than by three pixels", async ({ page }) => {
    // The half that made the board feel stuck rather than slow: a pan delta is screen
    // pixels one for one, so reading lines as pixels moved it 3px per notch.
    const board = await openBoard(page);
    const middle = { x: board.box.width / 2, y: board.box.height / 2 };
    const before = await camera(page);

    await dispatchWheelAt(board, middle, { y: FIREFOX_NOTCH_LINES, mode: DELTA_LINE });

    const after = await camera(page);
    // 3 lines × 40px. Deliberately exact: this is a screen-pixel offset, and a bound
    // would pass just as happily on the 3px the bug produced.
    expect(after.y).toBeCloseTo(before.y - 120, 5);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.scale).toBe(before.scale);
  });

  test("a line-mode wheel scrolls sideways by a notch too", async ({ page }) => {
    // deltaX carries the pan on a tilt wheel and on macOS shift+wheel. Normalising one
    // axis and not the other would leave sideways scrolling slow on the browser this
    // whole spec exists for.
    const board = await openBoard(page);
    const middle = { x: board.box.width / 2, y: board.box.height / 2 };
    const before = await camera(page);

    await dispatchWheelAt(board, middle, { x: FIREFOX_NOTCH_LINES, mode: DELTA_LINE });

    const after = await camera(page);
    expect(after.x).toBeCloseTo(before.x - 120, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  test("a page-mode notch is a step, not a pixel", async ({ page }) => {
    // DOM_DELTA_PAGE is rare, but it is the same failure an order of magnitude further
    // on: one page read as one pixel is a board that does not move at all.
    const board = await openBoard(page);
    const middle = { x: board.box.width / 2, y: board.box.height / 2 };

    await dispatchWheelAt(board, middle, { y: -1, mode: DELTA_PAGE }, { ctrl: true });
    // 800px is far past the engine's clamp, so it is worth exactly one notch — the same
    // bound that makes a trackpad fling worth one notch.
    expect((await camera(page)).scale).toBeCloseTo(1.1, 5);

    await resetCamera(page);
    const before = await camera(page);
    await dispatchWheelAt(board, middle, { y: 1, mode: DELTA_PAGE });
    expect((await camera(page)).y).toBeCloseTo(before.y - 800, 5);
  });

  test("a pixel-mode event is still worth exactly what it was", async ({ page }) => {
    // The regression guard. Every browser that already worked has to keep its arithmetic
    // untouched, and this asserts it through the dispatch path so a normalisation applied
    // to the wrong branch would show up here rather than in zoom.spec.ts's blast radius.
    const board = await openBoard(page);
    const middle = { x: board.box.width / 2, y: board.box.height / 2 };

    await dispatchWheelAt(
      board,
      middle,
      { y: -CHROME_NOTCH_PX, mode: DELTA_PIXEL },
      { ctrl: true },
    );
    expect((await camera(page)).scale).toBeCloseTo(1.1, 5);

    await resetCamera(page);
    const before = await camera(page);
    await dispatchWheelAt(board, middle, { y: 40, mode: DELTA_PIXEL });
    expect((await camera(page)).y).toBeCloseTo(before.y - 40, 5);
  });

  test("a line-mode burst walks the zoom instead of teleporting", async ({ page }) => {
    // Continuity, the property zoom.spec.ts asserts for pixels, now that a line notch is
    // worth 120px rather than 3. A normalisation that overshot — multiplying by the
    // viewport, say — would pass every assertion above and fail here.
    const board = await openBoard(page);
    const middle = { x: board.box.width / 2, y: board.box.height / 2 };

    let previous = (await camera(page)).scale;
    for (let tick = 0; tick < 12; tick += 1) {
      await dispatchWheelAt(
        board,
        middle,
        { y: -FIREFOX_NOTCH_LINES, mode: DELTA_LINE },
        { ctrl: true },
      );
      const next = (await camera(page)).scale;
      expect(next, `tick ${tick} did not zoom in`).toBeGreaterThan(previous);
      expect(next / previous, `tick ${tick} jumped`).toBeLessThanOrEqual(1.101);
      previous = next;
    }
    // The same window zoom.spec.ts pins for twelve pixel notches, because after
    // normalisation it is the same gesture: 1.1¹² = 3.138.
    expect(previous).toBeGreaterThan(3.0);
    expect(previous).toBeLessThan(3.3);
  });
});
