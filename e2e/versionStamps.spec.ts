import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  OPEN_CANVAS,
  focusBoard,
  openBoard,
  patchedElements,
  pickTool,
  sceneElements,
  type Board,
  type SceneElement,
} from "./board.ts";

/**
 * A move is saved.
 *
 * It was not: gestures changed geometry without moving the element's version, and the
 * version is the only thing the autosave compares, so a dragged shape went back where
 * it was on reload. `ci_version_stamps.rs` pins the rule in the engine; this checks the
 * whole path — engine, host diff, the PATCH that actually leaves the page.
 */

const BOX = { x: OPEN_CANVAS.left + 120, y: OPEN_CANVAS.top + 100, w: 200, h: 140 };

async function drawBox(board: Board): Promise<void> {
  const { page, box } = board;
  await pickTool(page, "Rectangle");
  await page.mouse.move(box.x + BOX.x, box.y + BOX.y);
  await page.mouse.down();
  await page.mouse.move(box.x + BOX.x + BOX.w, box.y + BOX.y + BOX.h, { steps: 6 });
  await page.mouse.up();
}

/** The last copy of an element the page sent to the API, or undefined. */
async function lastSent(page: Page, id: string): Promise<SceneElement | undefined> {
  return (await patchedElements(page)).filter((el) => el.id === id).at(-1);
}

test("a moved shape is saved where it was moved to", async ({ page }) => {
  const board = await openBoard(page);
  await drawBox(board);
  const [drawn] = await sceneElements(page);
  // The first autosave carries the creation.
  await expect.poll(async () => (await lastSent(page, drawn!.id))?.x).toBeCloseTo(drawn!.x, 0);

  // By its top edge: the default background is transparent, so the middle is not on it.
  const grab = { x: board.box.x + BOX.x + BOX.w / 2, y: board.box.y + BOX.y };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 150, grab.y + 90, { steps: 8 });
  await page.mouse.up();

  const [moved] = await sceneElements(page);
  expect(moved!.x - drawn!.x, "setup: it moved").toBeCloseTo(150, 0);
  await expect
    .poll(async () => (await lastSent(page, drawn!.id))?.x, { message: "the move is sent" })
    .toBeCloseTo(moved!.x, 0);
  expect((await lastSent(page, drawn!.id))?.version).toBe(2);
});

test("undoing a move is saved too", async ({ page }) => {
  const board = await openBoard(page);
  await drawBox(board);
  const [drawn] = await sceneElements(page);
  const grab = { x: board.box.x + BOX.x + BOX.w / 2, y: board.box.y + BOX.y };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 150, grab.y + 90, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => (await lastSent(page, drawn!.id))?.x)
    .toBeCloseTo(drawn!.x + 150, 0);

  await focusBoard(board);
  await page.keyboard.press("Control+z");

  // An undo that restored the old stamp would be refused by the server as stale; it
  // goes out as a new edit, above the move it undoes.
  await expect
    .poll(async () => (await lastSent(page, drawn!.id))?.x, { message: "the undo is sent" })
    .toBeCloseTo(drawn!.x, 0);
  expect((await lastSent(page, drawn!.id))?.version).toBe(3);
});
