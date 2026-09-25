import { expect, test } from "./fixtures.ts";
import { OPEN_CANVAS, openBoard, pickTool, sceneElements, type Board } from "./board.ts";

/**
 * A bound arrow can be picked up and moved.
 *
 * It could not: dragged by its shaft, it ended exactly where it started, because every
 * frame of the move re-resolved its ends onto the shapes it was bound to and put it
 * back. Excalidraw's rule (`dragElements.ts@1118751f:110-157`) is that moving an arrow releases
 * each end whose shape is not moving with it. `ci_arrow_drag.rs` pins that; this checks a
 * real drag reaches it through the canvas listeners and the WASM boundary.
 */

const LEFT = { x: OPEN_CANVAS.left + 60, y: OPEN_CANVAS.top + 120, w: 110, h: 90 };
const RIGHT = { x: OPEN_CANVAS.left + 400, y: OPEN_CANVAS.top + 120, w: 110, h: 90 };
const MID_Y = LEFT.y + LEFT.h / 2;

function at(board: Board, x: number, y: number): { x: number; y: number } {
  return { x: board.box.x + x, y: board.box.y + y };
}

async function drag(board: Board, from: { x: number; y: number }, to: { x: number; y: number }) {
  const { page } = board;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(140);
}

async function boundArrow(board: Board): Promise<void> {
  for (const box of [LEFT, RIGHT]) {
    await pickTool(board.page, "Rectangle");
    await drag(board, at(board, box.x, box.y), at(board, box.x + box.w, box.y + box.h));
  }
  await pickTool(board.page, "Arrow");
  await drag(board, at(board, LEFT.x + LEFT.w / 2, MID_Y), at(board, RIGHT.x + RIGHT.w / 2, MID_Y));
}

async function theArrow(board: Board) {
  const arrow = (await sceneElements(board.page)).find((el) => el.type === "arrow");
  expect(arrow, "the arrow should exist").toBeTruthy();
  return arrow!;
}

test("a bound arrow dragged by its shaft moves, and lets go of its shapes", async ({ page }) => {
  const board = await openBoard(page);
  await boundArrow(board);
  const before = await theArrow(board);
  expect(before.startBinding, "setup: bound at the start").toBeTruthy();
  expect(before.endBinding, "setup: bound at the end").toBeTruthy();

  // On the shaft, a quarter of the way along — clear of both ends and of the midpoint
  // handle, where a press bends the arrow instead of moving it.
  const grab = at(board, before.x + before.width / 4, MID_Y);
  await drag(board, grab, { x: grab.x, y: grab.y + 150 });

  const after = await theArrow(board);
  expect(after.y - before.y, "it should have moved down with the pointer").toBeCloseTo(150, 0);
  expect(after.startBinding ?? null).toBeNull();
  expect(after.endBinding ?? null).toBeNull();
});
