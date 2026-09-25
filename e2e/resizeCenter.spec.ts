import { expect, test } from "./fixtures.ts";
import { OPEN_CANVAS, clickElement, openBoard, sceneElements, selection } from "./board.ts";
import type { Board, SceneElement } from "./board.ts";

/**
 * Alt held during a resize: every handle scales about the selection's own centre instead
 * of the opposite corner or side, one element or several, composed with Shift's aspect
 * lock (`shouldResizeFromCenter`, `resizeElements.ts@1118751f:621-727, 1052-1059`). The
 * engine tests pin the arithmetic (`ci_selection.rs`, `ci_group_resize.rs`,
 * `ci_text_resize.rs`); this is the same drag with a real mouse and a real Alt key.
 * `docs/reference/resize.md` › Transform engine.
 */

const HANDLE_OUT = 8;

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

test("Alt+drag on a corner grows a shape evenly about its own centre", async ({ page }) => {
  const board = await openBoard(page);
  await load(board, [
    { ...BASE, id: "rect", type: "rectangle", x: 0, y: 0, width: 100, height: 100 },
  ]);
  await clickElement(board, 0);
  expect(await selection(page)).toEqual(["rect"]);
  const before = await element(board, "rect");
  const centre = { x: before.x + before.width / 2, y: before.y + before.height / 2 };

  const corner = await onPage(board, before.x + before.width, before.y + before.height);
  await page.keyboard.down("Alt");
  await page.mouse.move(corner.x + HANDLE_OUT, corner.y + HANDLE_OUT);
  await page.mouse.down();
  await page.mouse.move(corner.x + HANDLE_OUT + 50, corner.y + HANDLE_OUT + 50, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Alt");

  const after = await element(board, "rect");
  // The pointer reached 50 past the original corner; from the centre that reach is
  // doubled, so the box grows to 200x200 evenly about the same centre.
  expect(after.width).toBeCloseTo(200, 0);
  expect(after.height).toBeCloseTo(200, 0);
  expect(after.x + after.width / 2).toBeCloseTo(centre.x, 0);
  expect(after.y + after.height / 2).toBeCloseTo(centre.y, 0);
});

test("without Alt the opposite corner holds still, for comparison", async ({ page }) => {
  const board = await openBoard(page);
  await load(board, [
    { ...BASE, id: "rect", type: "rectangle", x: 0, y: 0, width: 100, height: 100 },
  ]);
  await clickElement(board, 0);
  const before = await element(board, "rect");

  const corner = await onPage(board, before.x + before.width, before.y + before.height);
  await page.mouse.move(corner.x + HANDLE_OUT, corner.y + HANDLE_OUT);
  await page.mouse.down();
  await page.mouse.move(corner.x + HANDLE_OUT + 50, corner.y + HANDLE_OUT + 50, { steps: 6 });
  await page.mouse.up();

  const after = await element(board, "rect");
  // No Alt: the NW corner holds, so the box only grows to 150x150 and its top-left stays put.
  expect(after.width).toBeCloseTo(150, 0);
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
});
