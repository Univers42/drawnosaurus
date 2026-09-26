import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  OPEN_CANVAS,
  focusBoard,
  openBoard,
  pickTool,
  sceneElements,
  type Board,
  type SceneElement,
} from "./board.ts";

/**
 * The elbow arrow: drawn between two shapes it runs square from one to the other
 * (`elbowArrow.ts@1118751f`), follows a shape that moves, and is one of the three arrow
 * types — the row's third option and the arrow key's third press
 * (`actionProperties.tsx@1118751f:2057-2242`, `App.tsx@1118751f:5706-5714`). The route
 * itself is held to the oracle in `ci_elbow_oracle.rs`; this checks the gestures reach
 * it through the canvas listeners, the panel and the WASM boundary.
 */

type Arrow = SceneElement & { elbowed?: boolean };
type Rect = { x: number; y: number; w: number; h: number };

const LEFT: Rect = { x: OPEN_CANVAS.left + 60, y: OPEN_CANVAS.top + 60, w: 110, h: 90 };
const RIGHT: Rect = { x: OPEN_CANVAS.left + 400, y: OPEN_CANVAS.top + 220, w: 110, h: 90 };

const panel = (page: Page) => page.getByRole("complementary", { name: "Style inspector" });
const arrowType = (page: Page, name: string) =>
  panel(page).getByRole("radiogroup", { name: "Arrow type" }).getByRole("radio", { name });

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

async function twoShapes(board: Board): Promise<void> {
  for (const box of [LEFT, RIGHT]) {
    await pickTool(board.page, "Rectangle");
    await drag(board, at(board, box.x, box.y), at(board, box.x + box.w, box.y + box.h));
  }
}

/** From inside the left shape to inside the right one — off both centres, where a press
 *  binds to the centre itself and the end stays there. */
async function drawBetween(board: Board): Promise<void> {
  await drag(board, at(board, LEFT.x + 70, LEFT.y + 35), at(board, RIGHT.x + 40, RIGHT.y + 55));
}

async function scene(
  page: Page,
): Promise<{ left: SceneElement; right: SceneElement; arrow: Arrow }> {
  const elements = await sceneElements(page);
  const [left, right] = elements.filter((el) => el.type === "rectangle");
  const arrow = elements.find((el) => el.type === "arrow");
  expect(left && right, "both shapes should exist").toBeTruthy();
  expect(arrow, "the arrow should exist").toBeTruthy();
  return { left: left!, right: right!, arrow: arrow! };
}

function worldPoints(arrow: Arrow): [number, number][] {
  return (arrow.points ?? []).map(([x, y]) => [arrow.x + x, arrow.y + y]);
}

/** Every leg horizontal or vertical. */
function expectSquare(arrow: Arrow): void {
  const points = arrow.points ?? [];
  expect(points.length, "an elbow has corners").toBeGreaterThan(2);
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1]!, points[i]!];
    const straight = Math.abs(a[0] - b[0]) < 1e-6 || Math.abs(a[1] - b[1]) < 1e-6;
    expect(straight, `leg ${i} runs square: ${JSON.stringify([a, b])}`).toBe(true);
  }
}

/** How far a point is from a shape's outline — an elbow stops just short of it. */
function offOutline([x, y]: [number, number], shape: SceneElement): number {
  const dx = Math.max(shape.x - x, 0, x - (shape.x + shape.width));
  const dy = Math.max(shape.y - y, 0, y - (shape.y + shape.height));
  if (dx > 0 || dy > 0) return Math.hypot(dx, dy);
  return Math.min(x - shape.x, shape.x + shape.width - x, y - shape.y, shape.y + shape.height - y);
}

test("an elbow arrow drawn between two shapes binds both and runs square", async ({ page }) => {
  const board = await openBoard(page);
  await twoShapes(board);
  await pickTool(page, "Arrow");
  await arrowType(page, "Elbow arrow").click();
  await drawBetween(board);

  const { left, right, arrow } = await scene(page);
  expect(arrow.elbowed).toBe(true);
  expect(arrow.startBinding).toBe(left.id);
  expect(arrow.endBinding).toBe(right.id);
  expectSquare(arrow);
  const ends = worldPoints(arrow);
  expect(offOutline(ends[0]!, left), "starts at the left shape").toBeLessThan(10);
  expect(offOutline(ends.at(-1)!, right), "ends at the right shape").toBeLessThan(10);
  await expect(arrowType(page, "Elbow arrow")).toBeChecked();
});

test("moving a shape takes the elbow arrow's route with it", async ({ page }) => {
  const board = await openBoard(page);
  await twoShapes(board);
  await pickTool(page, "Arrow");
  await arrowType(page, "Elbow arrow").click();
  await drawBetween(board);
  const before = await scene(page);
  await focusBoard(board);

  // By the bottom edge — a transparent shape is hit on its outline, and the arrow comes
  // in from above and to the left, nowhere near it.
  const grab = at(board, RIGHT.x + RIGHT.w / 2, RIGHT.y + RIGHT.h);
  await drag(board, grab, { x: grab.x, y: grab.y + 100 });

  const after = await scene(page);
  expect(after.right.y - before.right.y, "setup: the shape moved").toBeCloseTo(100, 0);
  expect(after.arrow.endBinding, "still bound").toBe(after.right.id);
  expect(after.arrow.startBinding).toBe(after.left.id);
  expect(after.arrow.points).not.toEqual(before.arrow.points);
  expectSquare(after.arrow);
  const ends = worldPoints(after.arrow);
  expect(offOutline(ends[0]!, after.left), "still starts at the left shape").toBeLessThan(10);
  expect(offOutline(ends.at(-1)!, after.right), "ends where the shape went").toBeLessThan(10);
});

test("the arrow key cycles the type, and the row switches a drawn arrow", async ({ page }) => {
  const board = await openBoard(page);
  await twoShapes(board);
  await focusBoard(board);
  await page.keyboard.press("a");
  await expect(arrowType(page, "Curved arrow")).toBeChecked();
  for (const next of ["Elbow arrow", "Sharp arrow", "Curved arrow", "Elbow arrow"]) {
    await page.keyboard.press("a");
    await expect(arrowType(page, next), `the next press gives ${next}`).toBeChecked();
  }
  await drawBetween(board);
  const { left, right, arrow } = await scene(page);
  expect(arrow.elbowed).toBe(true);

  // Sharp: straight between where the route began and ended, still bound.
  await arrowType(page, "Sharp arrow").click();
  await expect.poll(async () => (await scene(page)).arrow.elbowed ?? false).toBe(false);
  const sharp = (await scene(page)).arrow;
  expect(sharp.points).toHaveLength(2);
  expect(sharp.roundness ?? null).toBeNull();
  expect(sharp.startBinding).toBe(left.id);
  expect(sharp.endBinding).toBe(right.id);

  await arrowType(page, "Curved arrow").click();
  await expect.poll(async () => (await scene(page)).arrow.roundness ?? null).not.toBeNull();

  // And back: routed again, square between the same two shapes.
  await arrowType(page, "Elbow arrow").click();
  await expect.poll(async () => (await scene(page)).arrow.elbowed ?? false).toBe(true);
  const elbow = (await scene(page)).arrow;
  expectSquare(elbow);
  expect(elbow.startBinding).toBe(left.id);
  expect(elbow.endBinding).toBe(right.id);
});
