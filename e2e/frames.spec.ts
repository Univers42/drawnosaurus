import { expect, test } from "./fixtures.ts";
import {
  OPEN_CANVAS,
  camera,
  focusBoard,
  openBoard,
  pickTool,
  regionInk,
  sceneElements,
  type Board,
  type SceneElement,
} from "./board.ts";

/**
 * Renaming a frame — Excalidraw parity for `editingFrame`
 * (`App.tsx@1118751f:2166-2170` `resetEditingFrame`, `:2219-2261` the input,
 * `:2334-2340` the double click that opens it). The engine owns the hit-test and the
 * commit (`frame_name_at` / `rename_frame`, `engine/frame_rename.rs`, covered by
 * `ci_frame.rs`'s `mod rename`); this drives the real double click that opens
 * `FrameRenameEditor.svelte` and checks both the scene and the canvas afterwards.
 */

// A frame drawn here gets the engine's own default name, "Frame 1" — the first frame on
// a blank board (`default_frame_name`, `engine/scene/frame.rs`) — so every test starts
// from a name already on screen, exactly as a real board would.
const FRAME = { x: OPEN_CANVAS.left + 40, y: OPEN_CANVAS.top + 80, w: 300, h: 200 };

/** Just right of the name's left edge and above the frame's own border — inside the
 *  label's hit box regardless of what it says (`frame_name_at`), the same offsets
 *  `stories/helpers.ts`'s `renameFrame` uses. */
const NAME_HIT = { x: FRAME.x + 8, y: FRAME.y - 8 };

/** Generously covers the label's painted box (`frame_name_box`: left-aligned at the
 *  frame's own left edge, its baseline a few pixels above the border) without reaching
 *  into the frame's own border or body. */
const NAME_REGION = {
  left: FRAME.x - 2,
  top: FRAME.y - 24,
  right: FRAME.x + 260,
  bottom: FRAME.y - 1,
};

const nameInput = (board: Board) => board.page.locator('input[aria-label="Frame name"]');

async function drawFrame(board: Board): Promise<SceneElement> {
  const { page, box } = board;
  await pickTool(page, "Frame");
  await page.mouse.move(box.x + FRAME.x, box.y + FRAME.y);
  await page.mouse.down();
  await page.mouse.move(box.x + FRAME.x + FRAME.w, box.y + FRAME.y + FRAME.h, { steps: 8 });
  await page.mouse.up();
  const frame = (await sceneElements(page)).find((el) => el.type === "frame");
  if (!frame) throw new Error("no frame was drawn");
  return frame;
}

/** A screen point for a world point — the camera starts at `x: 0, y: 0, scale: 1`, so
 *  world and canvas-relative pixels coincide until something pans or zooms, which none
 *  of these tests do (`stories/helpers.ts`'s own `worldToCanvas` makes the same call). */
async function toCanvas(board: Board, wx: number, wy: number) {
  const { x, y, scale } = await camera(board.page);
  return { x: wx * scale + x, y: wy * scale + y };
}

async function doubleClickName(board: Board): Promise<void> {
  const at = await toCanvas(board, NAME_HIT.x, NAME_HIT.y);
  await board.page.mouse.dblclick(board.box.x + at.x, board.box.y + at.y);
}

test("double-clicking the name opens an editor with the text selected", async ({ page }) => {
  const board = await openBoard(page);
  const frame = await drawFrame(board);
  expect(frame.name, "the engine's own default name").toBe("Frame 1");
  expect(await regionInk(page, NAME_REGION), "the default name is already painted").toBeGreaterThan(
    0,
  );

  await doubleClickName(board);
  const input = nameInput(board);
  await expect(input).toBeVisible();
  await expect(input).toHaveValue("Frame 1");
  const selection = await input.evaluate((node: HTMLInputElement) => ({
    start: node.selectionStart,
    end: node.selectionEnd,
    length: node.value.length,
  }));
  expect(selection).toEqual({ start: 0, end: selection.length, length: selection.length });
});

test("Enter commits the new name as one stamped step, and it is what gets painted", async ({
  page,
}) => {
  const board = await openBoard(page);
  const frame = await drawFrame(board);
  const before = (await sceneElements(page)).find((el) => el.id === frame.id)!;

  await doubleClickName(board);
  const input = nameInput(board);
  await input.fill("Clients");
  await page.keyboard.press("Enter");
  await expect(input).toHaveCount(0);

  const built = await sceneElements(page);
  expect(built, "no stray element from the edit").toHaveLength(1);
  const after = built.find((el) => el.id === frame.id)!;
  expect(after.name).toBe("Clients");
  expect(after.version ?? 0, "the stamp moved").toBeGreaterThan(before.version ?? 0);
  // The new name's own patch of canvas is what is now painted there.
  expect(
    await regionInk(page, NAME_REGION),
    "the committed name is painted, not just saved to the scene",
  ).toBeGreaterThan(0);
});

test("Escape commits too, exactly as Enter does — never a revert", async ({ page }) => {
  const board = await openBoard(page);
  const frame = await drawFrame(board);

  await doubleClickName(board);
  const input = nameInput(board);
  await input.fill("Services");
  await page.keyboard.press("Escape");
  await expect(input).toHaveCount(0);

  const after = (await sceneElements(page)).find((el) => el.id === frame.id)!;
  expect(after.name).toBe("Services");
});

test("blur commits the same way", async ({ page }) => {
  const board = await openBoard(page);
  const frame = await drawFrame(board);

  await doubleClickName(board);
  const input = nameInput(board);
  await input.fill("Data");
  await focusBoard(board); // clicks elsewhere on the board, blurring the input
  await expect(input).toHaveCount(0);

  const after = (await sceneElements(page)).find((el) => el.id === frame.id)!;
  expect(after.name).toBe("Data");
});

test("an emptied name falls back to the generic default, never blank", async ({ page }) => {
  const board = await openBoard(page);
  const frame = await drawFrame(board);

  await doubleClickName(board);
  const input = nameInput(board);
  await input.fill("   ");
  await page.keyboard.press("Enter");
  await expect(input).toHaveCount(0);

  const after = (await sceneElements(page)).find((el) => el.id === frame.id)!;
  expect(after.name ?? null, "stored as none, not an empty string").toBeNull();
  expect(
    await regionInk(page, NAME_REGION),
    "still painted — the generic default, not a blank label",
  ).toBeGreaterThan(0);
});

test("the rename is one undo step, separate from the frame's own creation", async ({ page }) => {
  const board = await openBoard(page);
  const frame = await drawFrame(board);

  await doubleClickName(board);
  const input = nameInput(board);
  await input.fill("Actions");
  await page.keyboard.press("Enter");
  await expect(input).toHaveCount(0);
  expect((await sceneElements(page)).find((el) => el.id === frame.id)!.name).toBe("Actions");

  await focusBoard(board);
  await page.keyboard.press("Control+z");
  await expect
    .poll(async () => (await sceneElements(page)).find((el) => el.id === frame.id)?.name)
    .toBe("Frame 1");
  expect((await sceneElements(page)).length, "one undo only reverted the name").toBe(1);

  // A second undo reaches further back, to before the frame existed at all — proving the
  // rename was its own, separate step and not folded into the frame's creation.
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await sceneElements(page)).length).toBe(0);
});
