import { expect, test } from "./fixtures.ts";
import { OPEN_CANVAS, clickElement, openBoard, sceneElements } from "./board.ts";
import type { Board, SceneElement } from "./board.ts";

/**
 * Shift held while dragging and while turning, through a real mouse and a real Shift key.
 *
 * The engine tests hold the geometry to the oracle's own numbers
 * (`ci_end_snap.rs`, `ci_rotate_lock.rs`), but every one of them calls `move_pointer(..,
 * square, ..)` **directly** and passes the flag in by hand. None of them would notice if
 * the host stopped forwarding `event.shiftKey`, and that is the one link in the chain this
 * file exists to cover: `pointerInput.ts:27` is a single expression, and
 * `packages/common/src/keys.ts@1118751f:151-153` (`shouldRotateWithDiscreteAngle`) is the
 * behaviour being ported.
 *
 * The two locks are the same rounding, so both assertions can be the same sentence: the
 * angle is a whole number of 15-degree steps, and it is *not* the pointer's own angle.
 */

const STEP = 15;

/**
 * How far above a shape's top edge the rotation handle's centre sits, in screen pixels.
 *
 * The engine's own numbers, added up rather than guessed: the selection frame is
 * `FRAME_MARGIN_PX` = 4 outside the outline (`handles.rs:139`), a handle's centre is half
 * its 8px box further out (`:151`), and the rotation handle is `ROTATE_GAP_PX` = 26 above
 * the frame (`:258`, `engine/mod.rs:85`). 4 + 4 + 26. The grab reaches 5.66px
 * (`handles.rs:162`), so a spec has to be within a few pixels of this or the press lands on
 * nothing at all and the gesture it meant to perform never happens.
 */
const ROTATE_HANDLE_OUT = 34;

const BASE = {
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "#a5d8ff",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 0,
  opacity: 100,
  roundness: null,
  seed: 1,
  groupIds: [],
  version: 1,
  versionNonce: 1,
  updated: 0,
  isDeleted: false,
};

async function load(board: Board, elements: Record<string, unknown>[]): Promise<void> {
  await board.page.evaluate(
    ({ elements, at }) => {
      const engine = window.__drawEngine!;
      const origin = engine.screenToWorld(at.x, at.y);
      const placed = elements.map((element) => ({
        ...element,
        x: (element.x as number) + origin.x,
        y: (element.y as number) + origin.y,
      }));
      const file = { type: "osidraw", version: 1, source: "e2e", elements: placed };
      if (!engine.loadScene(JSON.stringify(file))) throw new Error("the scene was refused");
    },
    { elements, at: { x: OPEN_CANVAS.left + 80, y: OPEN_CANVAS.top + 80 } },
  );
}

async function element(board: Board, id: string): Promise<SceneElement> {
  const found = (await sceneElements(board.page)).find((el) => el.id === id);
  if (!found) throw new Error(`no element ${id}`);
  return found;
}

/** A world point on the page, at the camera the engine holds. */
async function onPage(board: Board, wx: number, wy: number): Promise<{ x: number; y: number }> {
  const { x, y, scale } = await board.page.evaluate(() => window.__drawEngine!.camera);
  return { x: board.box.x + wx * scale + x, y: board.box.y + wy * scale + y };
}

const degrees = (rad: number): number => ((rad * 180) / Math.PI + 360) % 360;

/** The step `degrees` is on, as a whole number, or `null` when it is on none of them. */
function stepOf(deg: number): number | null {
  for (let step = 0; step < 24; step++) {
    if (Math.abs(deg - step * STEP) < 0.01) return step;
  }
  return null;
}

test("Shift+drag on a line's end holds the segment to 15 degree steps", async ({ page }) => {
  const board = await openBoard(page);
  // `points` is not optional for a linear element: `world_points` returns nothing without
  // it (`selection/linear.rs:79-82`), and with no points there is no endpoint handle to
  // grab — the drag below would move nothing and the spec would read an untouched element.
  await load(board, [
    {
      ...BASE,
      id: "line",
      type: "line",
      x: 0,
      y: 0,
      width: 200,
      height: 0,
      points: [
        [0, 0],
        [200, 0],
      ],
    },
  ]);
  await clickElement(board, 0);

  // The end point is the element's far corner, and the drag is anchored at the *other*
  // end (`engine/pointer_move.rs:392`) — so the bearing to measure is from there.
  const before = await element(board, "line");
  const anchor = { x: before.x, y: before.y };
  const end = { x: before.x + before.width, y: before.y + before.height };

  // 20 degrees, which is 5 off the 15-degree step it should land on.
  const REACH = 200;
  const raw = 20;
  const to = {
    x: anchor.x + REACH * Math.cos((raw * Math.PI) / 180),
    y: anchor.y + REACH * Math.sin((raw * Math.PI) / 180),
  };

  const from = await onPage(board, end.x, end.y);
  const target = await onPage(board, to.x, to.y);
  await page.keyboard.down("Shift");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Shift");

  const after = await element(board, "line");
  const dx = after.x + after.width - anchor.x;
  const dy = after.y + after.height - anchor.y;
  const got = degrees(Math.atan2(dy, dx));
  expect(stepOf(got), `the locked segment sat at ${got} degrees`).toBe(1);
  expect(Math.abs(got - raw)).toBeGreaterThan(1);
});

test("Shift+turn holds the angle to 15 degree steps", async ({ page }, testInfo) => {
  const board = await openBoard(page);
  await load(board, [
    { ...BASE, id: "rect", type: "rectangle", x: 0, y: 0, width: 100, height: 100 },
  ]);
  await clickElement(board, 0);

  const before = await element(board, "rect");
  const centre = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
  // The rotation handle sits above the shape, on the vertical through the centre.
  const handle = { x: centre.x, y: before.y - ROTATE_HANDLE_OUT };

  // Due east of the centre asks for 90 degrees exactly; nudged off it, to 100, which is 5
  // from the 105 step and 10 from the 90 one — so 105 is the answer, and it is not the
  // pointer's own angle.
  const raw = 100;
  const REACH = 150;
  const bearing = ((raw - 90) * Math.PI) / 180;
  const to = {
    x: centre.x + REACH * Math.cos(bearing),
    y: centre.y + REACH * Math.sin(bearing),
  };

  const from = await onPage(board, handle.x, handle.y);
  const target = await onPage(board, to.x, to.y);
  await page.keyboard.down("Shift");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Shift");

  const after = await element(board, "rect");
  const got = degrees(after.angle ?? 0);
  await page.screenshot({ path: testInfo.outputPath("shift-rotate-90.png") });
  expect(stepOf(got), `the locked turn sat at ${got} degrees`).toBe(7);
  expect(Math.abs(got - raw)).toBeGreaterThan(1);
});

test("without Shift the turn is the pointer's own angle, for comparison", async ({ page }) => {
  const board = await openBoard(page);
  await load(board, [
    { ...BASE, id: "rect", type: "rectangle", x: 0, y: 0, width: 100, height: 100 },
  ]);
  // No `focusBoard` here, unlike a spec that presses keys: this is a mouse drag, and
  // focusing the board *after* selecting drops the selection (BUNNY.md §11 puts the focus
  // call before the select for exactly that reason), so the handle press would land on an
  // empty canvas and there would be no turn to read.
  await clickElement(board, 0);

  const before = await element(board, "rect");
  const centre = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
  const handle = { x: centre.x, y: before.y - ROTATE_HANDLE_OUT };

  const raw = 100;
  const REACH = 150;
  const bearing = ((raw - 90) * Math.PI) / 180;
  const to = {
    x: centre.x + REACH * Math.cos(bearing),
    y: centre.y + REACH * Math.sin(bearing),
  };

  const from = await onPage(board, handle.x, handle.y);
  const target = await onPage(board, to.x, to.y);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.mouse.up();

  const after = await element(board, "rect");
  const got = degrees(after.angle ?? 0);
  expect(Math.abs(got - raw)).toBeLessThan(1.5);
  expect(stepOf(got)).toBeNull();
});
