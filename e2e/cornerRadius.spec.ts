import { expect, test } from "./fixtures.ts";
import { OPEN_CANVAS, openBoard, pickTool, regionInk, sceneElements, type Board } from "./board.ts";

/**
 * Rounding a rectangle's corners by dragging the handle inside each one.
 *
 * `ci_corner_radius.rs` pins the geometry and the gesture. This checks two things the
 * engine tests cannot: that a real press reaches the handle through the canvas listeners,
 * and that the corner **renders** rounder — a radius that changed in the model but hit a
 * stale render cache would pass every state assertion and change nothing on screen, which
 * is exactly what leaving it out of the geometry fingerprint would have done.
 */

/** Canvas-relative. 220x160, so the adaptive corner is 32px and handles sit 32px in. */
const BOX = { x: OPEN_CANVAS.left + 100, y: OPEN_CANVAS.top + 90, w: 220, h: 160 };
const ADAPTIVE = 32;

function at(board: Board, x: number, y: number): { x: number; y: number } {
  return { x: board.box.x + x, y: board.box.y + y };
}

async function drawBox(board: Board): Promise<void> {
  const { page } = board;
  await pickTool(page, "Rectangle");
  const from = at(board, BOX.x, BOX.y);
  const to = at(board, BOX.x + BOX.w, BOX.y + BOX.h);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

async function theBox(board: Board) {
  const found = (await sceneElements(board.page)).find((el) => el.type === "rectangle");
  expect(found, "the rectangle should exist").toBeTruthy();
  return found!;
}

/** Drags the top-left radius handle inward along its diagonal by `by`. */
async function pullTopLeft(board: Board, by: number): Promise<void> {
  const { page } = board;
  const handle = at(board, BOX.x + ADAPTIVE, BOX.y + ADAPTIVE);
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  for (let step = 1; step <= 5; step += 1) {
    await page.mouse.move(handle.x + (by * step) / 5, handle.y + (by * step) / 5);
  }
  await page.mouse.up();
  await page.waitForTimeout(140);
}

test("dragging a corner handle inward rounds the corners", async ({ page }) => {
  const board = await openBoard(page);
  await drawBox(board);

  await pullTopLeft(board, 30);

  const box = await theBox(board);
  expect(box.cornerRadius).toBeCloseTo(ADAPTIVE + 30, 0);
  expect(box.x, "the shape itself did not move").toBeCloseTo(BOX.x, 0);
  expect(box.width).toBeCloseTo(BOX.w, 0);
});

/**
 * The pixels. A patch on the corner point itself: when the corner is sharp both edges
 * meet there, so it is full of ink; rounded hard, the arc pulls tens of pixels away and
 * the patch empties. Measured, not assumed from the number.
 *
 * (The first version measured a patch a few pixels *inside* the corner, on the theory
 * that a sharp outline crosses it. It does not — a sharp outline runs along the edges and
 * meets only at the corner — so the "sharp" reading was zero and the test proved nothing.)
 */
test("the corner renders rounder, not just the number", async ({ page }) => {
  const board = await openBoard(page);
  await drawBox(board);
  // Deselected for both readings, so the handles themselves are not in the patch.
  const away = at(board, OPEN_CANVAS.right - 30, OPEN_CANVAS.bottom - 30);
  const patch = {
    left: BOX.x - 3,
    top: BOX.y - 3,
    right: BOX.x + 5,
    bottom: BOX.y + 5,
  };

  // Sharp first, so the outline runs straight through the corner patch.
  await page.getByRole("button", { name: "Sharp" }).click();
  await page.mouse.click(away.x, away.y);
  await page.waitForTimeout(120);
  const sharp = await regionInk(page, patch);

  // Select it again by its outline, round it hard, and deselect.
  const edge = at(board, BOX.x + BOX.w / 2, BOX.y);
  await page.mouse.click(edge.x, edge.y);
  await page.waitForTimeout(100);
  const handle = at(board, BOX.x + 12, BOX.y + 12);
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  for (let step = 1; step <= 5; step += 1) {
    await page.mouse.move(handle.x + (60 * step) / 5, handle.y + (60 * step) / 5);
  }
  await page.mouse.up();
  await page.mouse.click(away.x, away.y);
  await page.waitForTimeout(140);
  const rounded = await regionInk(page, patch);

  expect((await theBox(board)).cornerRadius, "the drag should have rounded it").toBeGreaterThan(50);
  expect(sharp, "setup: a sharp corner should put ink on its corner point").toBeGreaterThan(0.1);
  expect(
    rounded,
    `the outline should have left the corner point: ${sharp} sharp, ${rounded} rounded`,
  ).toBeLessThan(sharp / 4);
});

test("dragging back past the corner makes it sharp", async ({ page }) => {
  const board = await openBoard(page);
  await drawBox(board);

  await pullTopLeft(board, -45);

  const box = await theBox(board);
  expect(box.roundness ?? null, "the panel should read Sharp").toBeNull();
});
