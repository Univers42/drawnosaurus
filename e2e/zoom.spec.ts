import { expect, test } from "@playwright/test";
import { camera, openBoard, shownZoomPercent, stepRatio, wheelAt } from "./board.ts";

/**
 * Wheel zoom, through a real browser and a real wheel.
 *
 * The engine's own tests (`engine/crates/draw-engine/tests/ci_zoom_wheel.rs`) already pin
 * the arithmetic, and they are faster and sharper than anything here. This file exists
 * for the half of the bug those cannot see: whether the browser's wheel event reaches
 * that arithmetic at all, with its delta intact. The zoom used to jump by 2.7× a notch
 * because the *host* turned the delta into a factor before the engine ever saw it, and no
 * amount of Rust testing would have caught that.
 *
 * Reproducible by construction: no API, no Mongo, a fixed viewport, no retries, and every
 * assertion is on a number the engine reports rather than on a pixel or a frame time.
 */

/** Wheel deltas a browser actually sends, spanning two orders of magnitude. */
const NOTCH = 100;
const TRACKPAD_NUDGE = 4;
const FLING = 240;

test.describe("wheel zoom", () => {
  test("a notch moves the zoom by a step you can follow, not a leap", async ({ page }) => {
    const board = await openBoard(page);
    const middle = { x: board.box.width / 2, y: board.box.height / 2 };

    const before = await camera(page);
    expect(before.scale).toBeCloseTo(1, 5);

    await wheelAt(board, middle, { y: -NOTCH }, { ctrl: true });

    const after = await camera(page);
    // One tenth, which is what `ZOOM_STEP` means. The assertion is exact rather than a
    // bound because this is the single most common gesture in the app and a drift in it
    // should be a decision, not a surprise.
    expect(after.scale).toBeCloseTo(1.1, 5);
    // And the number in front of the user agrees with the camera behind it.
    expect(await shownZoomPercent(page)).toBe(110);
  });

  test("a fling is worth a notch rather than a teleport", async ({ page }) => {
    // The regression. `exp(-delta * 0.01)` gave `e^2.4` for this — a 11× jump — and the
    // board vanished. The clamp in the engine is what turns it into one step.
    const board = await openBoard(page);
    const middle = { x: board.box.width / 2, y: board.box.height / 2 };

    await wheelAt(board, middle, { y: -FLING }, { ctrl: true });

    expect((await camera(page)).scale).toBeCloseTo(1.1, 5);
  });

  test("a burst of wheel events walks the zoom instead of teleporting", async ({ page }) => {
    // Continuity is a property of the sequence. Each event has to move the zoom, move it
    // the same way as the last, and move it by an amount an eye can follow — otherwise
    // the picture between two frames has no relationship to the one before it, which is
    // what "jumping" actually means.
    const board = await openBoard(page);
    const middle = { x: board.box.width / 2, y: board.box.height / 2 };

    let previous = (await camera(page)).scale;
    const ratios: number[] = [];
    for (let tick = 0; tick < 12; tick += 1) {
      await wheelAt(board, middle, { y: -NOTCH }, { ctrl: true });
      const next = (await camera(page)).scale;
      expect(next, `tick ${tick} did not zoom in`).toBeGreaterThan(previous);
      ratios.push(stepRatio(previous, next));
      previous = next;
    }

    for (const [tick, ratio] of ratios.entries()) {
      expect(ratio, `tick ${tick} jumped by ${ratio}×`).toBeLessThanOrEqual(1.26);
    }
    // Twelve notches land near 6.5×: a tenth of the scale each, compounding, and growing
    // once past 100% where the `log10` amplification starts. The bound is here for the
    // contrast — the handler this replaced multiplied by `e` per notch and hit the 30×
    // ceiling on the fourth.
    expect(previous).toBeGreaterThan(5.5);
    expect(previous).toBeLessThan(7.5);
  });

  test("a small trackpad nudge is a small step, not a full notch", async ({ page }) => {
    // The other half of continuity: below the clamp the step has to scale with the delta,
    // or a trackpad — which sends a stream of tiny deltas — moves in notches anyway.
    const board = await openBoard(page);
    const middle = { x: board.box.width / 2, y: board.box.height / 2 };

    await wheelAt(board, middle, { y: -TRACKPAD_NUDGE }, { ctrl: true });

    const nudged = (await camera(page)).scale;
    expect(nudged).toBeGreaterThan(1);
    expect(nudged).toBeLessThan(1.05);
  });

  test("the point under the cursor stays under the cursor", async ({ page }) => {
    // The reason zoom is anchored. When this drifts, zooming in on a detail walks it off
    // the screen and you chase it with the pan — the same complaint as a jump, arriving
    // by a different route. Off-centre on purpose: anchoring at the middle is the one
    // case a broken anchor still gets right.
    const board = await openBoard(page);
    const at = { x: 320, y: 220 };

    const under = (point: { x: number; y: number }) =>
      page.evaluate((at) => window.__drawEngine!.screenToWorld(at.x, at.y), point);

    const grabbed = await under(at);

    for (const delta of [-NOTCH, -NOTCH, TRACKPAD_NUDGE, -FLING, NOTCH]) {
      await wheelAt(board, at, { y: delta }, { ctrl: true });
      const now = await under(at);
      expect(now.x).toBeCloseTo(grabbed.x, 3);
      expect(now.y).toBeCloseTo(grabbed.y, 3);
    }
  });

  test("the zoom stops at its limits instead of running away", async ({ page }) => {
    const board = await openBoard(page);
    const middle = { x: board.box.width / 2, y: board.box.height / 2 };

    for (let tick = 0; tick < 60; tick += 1) {
      await wheelAt(board, middle, { y: -FLING }, { ctrl: true });
    }
    expect((await camera(page)).scale).toBeCloseTo(30, 5);

    for (let tick = 0; tick < 90; tick += 1) {
      await wheelAt(board, middle, { y: FLING }, { ctrl: true });
    }
    expect((await camera(page)).scale).toBeCloseTo(0.1, 5);
  });
});

test.describe("wheel scroll", () => {
  test("a plain wheel scrolls the board and leaves the zoom alone", async ({ page }) => {
    const board = await openBoard(page);
    const middle = { x: board.box.width / 2, y: board.box.height / 2 };
    const before = await camera(page);

    await wheelAt(board, middle, { x: 30, y: 40 });

    const after = await camera(page);
    // Screen pixels, one for one, the other way: scrolling down sends the content up.
    expect(after.x).toBeCloseTo(before.x - 30, 5);
    expect(after.y).toBeCloseTo(before.y - 40, 5);
    expect(after.scale).toBe(before.scale);
  });

  test("shift+wheel scrolls sideways", async ({ page }) => {
    const board = await openBoard(page);
    const middle = { x: board.box.width / 2, y: board.box.height / 2 };
    const before = await camera(page);

    await wheelAt(board, middle, { y: 40 }, { shift: true });

    const after = await camera(page);
    expect(after.x).toBeCloseTo(before.x - 40, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
    expect(after.scale).toBe(before.scale);
  });

  test("scrolling is reversible, so it can be undone by hand", async ({ page }) => {
    // Pan has no undo — the way back is to scroll back. That only works if the offsets
    // cancel exactly, which they stop doing the moment anything rounds or scales them.
    const board = await openBoard(page);
    const middle = { x: board.box.width / 2, y: board.box.height / 2 };
    const before = await camera(page);

    for (const step of [17, -40, 120, -97]) {
      await wheelAt(board, middle, { x: step, y: -step });
    }
    await wheelAt(board, middle, { x: 0, y: 0 });
    for (const step of [17, -40, 120, -97]) {
      await wheelAt(board, middle, { x: -step, y: step });
    }

    const after = await camera(page);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  test("scrolling keeps its step at every zoom level", async ({ page }) => {
    // A scroll is specified in screen pixels, so the same wheel event must move the view
    // the same distance on screen whether the board is at 10% or 3000%. Scaling it by the
    // zoom instead — an easy thing to "fix" — makes the board unscrollable when zoomed in.
    const board = await openBoard(page);
    const middle = { x: board.box.width / 2, y: board.box.height / 2 };

    for (const target of [0.25, 1, 8]) {
      await page.evaluate((scale) => {
        const engine = window.__drawEngine!;
        engine.zoomAt(0, 0, scale / engine.camera.scale);
      }, target);
      const before = await camera(page);
      await wheelAt(board, middle, { y: 50 });
      const after = await camera(page);
      expect(after.y, `at zoom ${target}`).toBeCloseTo(before.y - 50, 5);
    }
  });
});
