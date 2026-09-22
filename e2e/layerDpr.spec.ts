import { expect, test } from "./fixtures.ts";
import { canvasInk, openBoard, pickTool, type Board } from "./board.ts";

/**
 * The static layer when the device pixel ratio changes underneath it.
 *
 * `layer.spec.ts` checks the layer thoroughly and cannot see this, for one structural
 * reason: the whole suite runs at `deviceScaleFactor: 1`, and at dpr 1 the painter's two
 * resolutions are the same number — `quality_dpr = min(dpr, 2)` and
 * `interactive_dpr = max(1, quality_dpr / 2)` are both 1.0. The device size therefore
 * never changes, the layer is never rebuilt mid-session, and the path this file exercises
 * is never entered.
 *
 * Above dpr 1 it is entered constantly. `frame.rs` picks the interactive resolution while
 * `in_motion()` and the quality one otherwise, so on a HiDPI screen every pan flips the
 * device size 2 -> 1 when it starts and 1 -> 2 when the 140ms motion tail expires — twice
 * per gesture, on the most common gesture there is.
 *
 * The symptom is not subtle: the background and every element vanish and stay vanished,
 * because an empty layer gets blitted over the screen and then the frame loop stops. It
 * was reported from a real machine while every test here was green.
 *
 * So this file is deliberately pinned to `deviceScaleFactor: 2`. It is the cheapest thing
 * that would have caught it.
 */
test.use({ deviceScaleFactor: 2 });

/** The 140ms motion tail in `MOTION_MS`, plus room for the frame that follows it. */
const PAST_THE_MOTION_TAIL = 400;

async function drawThreeShapes(board: Board): Promise<void> {
  const { page, box } = board;
  for (const [i, kind] of ["Rectangle", "Ellipse", "Diamond"].entries()) {
    await pickTool(page, kind);
    await page.mouse.move(box.x + 500 + i * 180, box.y + 220 + i * 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 630 + i * 180, box.y + 330 + i * 40, { steps: 6 });
    await page.mouse.up();
  }
  await pickTool(page, "Select");
}

test.describe("static layer across a dpr change", () => {
  test("the board is still there after the motion tail expires", async ({ page }) => {
    const board = await openBoard(page);
    await drawThreeShapes(board);
    await page.waitForTimeout(300);

    const drawn = await canvasInk(page);
    expect(drawn, "nothing was drawn, so the rest of this test proves nothing").toBeGreaterThan(
      0.002,
    );

    // Sixty pixels. Far too small to move anything out of view, so any loss of content
    // is the painter's doing and not the camera's — which is what makes this assertion
    // safe to make at all.
    await pickTool(page, "Pan");
    const from = { x: board.box.x + 800, y: board.box.y + 400 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let step = 1; step <= 4; step += 1) {
      await page.mouse.move(from.x + step * 15, from.y + step * 9);
    }
    await page.mouse.up();

    // The dpr flips back to the quality resolution here, the layer is rebuilt at the new
    // device size, and the frame loop stops. Before the fix the canvas went to roughly a
    // tenth of its ink and stayed there.
    await page.waitForTimeout(PAST_THE_MOTION_TAIL);

    expect(
      await canvasInk(page),
      "the board went blank after the pan settled — an empty layer was blitted over it",
    ).toBeGreaterThan(drawn * 0.8);
  });

  test("it does not come back on its own, so a stale frame would go unnoticed", async ({
    page,
  }) => {
    // The half that makes it a bug rather than a flicker. Once the blank layer is on the
    // canvas, `needs_frame()` is false and nothing schedules another frame, so the board
    // stays empty until something forces a layer-key change. A test that only sampled
    // once, at a lucky moment, could still pass; this one waits.
    const board = await openBoard(page);
    await drawThreeShapes(board);
    await page.waitForTimeout(300);
    const drawn = await canvasInk(page);

    await pickTool(page, "Pan");
    const from = { x: board.box.x + 800, y: board.box.y + 400 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + 25);
    await page.mouse.up();

    await page.waitForTimeout(PAST_THE_MOTION_TAIL);
    // A bare pointer move publishes nothing and must not be what repairs the picture.
    await page.mouse.move(from.x + 45, from.y + 30);
    await page.waitForTimeout(500);

    expect(await canvasInk(page)).toBeGreaterThan(drawn * 0.8);
  });

  test("a wheel pan is no different from a drag pan", async ({ page }) => {
    // Wheel goes through `pan_by` and a drag through `begin_pan`/`move_pointer`, but both
    // call `bump_motion`, so both flip the resolution twice. Scrolling is the gesture the
    // report actually named.
    const board = await openBoard(page);
    await drawThreeShapes(board);
    await page.waitForTimeout(300);
    const drawn = await canvasInk(page);

    await page.mouse.move(board.box.x + 800, board.box.y + 400);
    await page.mouse.wheel(0, 50);
    await page.waitForTimeout(PAST_THE_MOTION_TAIL);

    expect(await canvasInk(page)).toBeGreaterThan(drawn * 0.8);
  });
});
