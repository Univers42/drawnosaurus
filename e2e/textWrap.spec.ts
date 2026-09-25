import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  focusBoard,
  OPEN_CANVAS,
  openBoard,
  pickTool,
  sceneElements,
  type Board,
  type SceneElement,
} from "./board.ts";
import { editor, writeText } from "./textBoard.ts";

/**
 * The style panel's Text wrap row (`inspector.ts` › `TEXT_WRAPS`, `DrawInspector.svelte`
 * › `setWrap`): a selection holding both a free text and a label writes both together,
 * one engine call (`engine.setTextWrap`, `engine/style.rs`), so one Ctrl+Z undoes both.
 * Reported: the row made two separate engine calls, `setTextAutoResize` and
 * `setLabelWrap`, so a mixed selection took two undos to put back
 * (`docs/reference/console.md`).
 */

const SHAPE = {
  left: OPEN_CANVAS.left + 120,
  top: OPEN_CANVAS.top + 120,
  right: OPEN_CANVAS.left + 360,
  bottom: OPEN_CANVAS.top + 200,
};

async function drawShape(board: Board): Promise<void> {
  const { page, box } = board;
  await pickTool(page, "Rectangle");
  await page.mouse.move(box.x + SHAPE.left, box.y + SHAPE.top);
  await page.mouse.down();
  await page.mouse.move(box.x + SHAPE.right, box.y + SHAPE.bottom, { steps: 8 });
  await page.mouse.up();
  await pickTool(page, "Select");
}

async function byType(page: Page, type: "text" | "rectangle"): Promise<SceneElement> {
  const found = (await sceneElements(page)).find((element) => element.type === type);
  if (!found) throw new Error(`no ${type} on the board`);
  return found;
}

type WrapState = SceneElement & { wrap?: boolean; autoResize?: boolean };

async function elementById(page: Page, id: string): Promise<WrapState> {
  const found = (await sceneElements(page)).find((element) => element.id === id);
  if (!found) throw new Error(`no element ${id}`);
  return found as WrapState;
}

test("the wrap row writes a free text and a label as one step of undo", async ({ page }) => {
  const board = await openBoard(page);
  await drawShape(board);
  const rect = await byType(page, "rectangle");
  await page.mouse.dblclick(
    board.box.x + rect.x + rect.width / 2,
    board.box.y + rect.y + rect.height / 2,
  );
  await expect(editor(board)).toBeFocused();
  await page.keyboard.type("the quick brown fox jumps over");
  await page.keyboard.press("Control+Enter");
  const freeText = await writeText(board, { x: 950, y: 300 }, "a free text of its own");
  const labelId = (await byType(page, "rectangle")).boundTextId;
  if (!labelId) throw new Error("the shape has no label");

  await focusBoard(board);
  await page.keyboard.press("Control+a");

  const wrapRow = page
    .getByRole("complementary", { name: "Style inspector" })
    .getByRole("group", { name: "Text wrap" });
  await expect(wrapRow).toBeVisible();

  // A first, unambiguous state for both, from the fresh defaults: the free text fixed to
  // its width, the label wrapping inside its shape (`Some(false)`/`Some(true)` written,
  // not left as the default `None` — a real change on both from a click that only needs
  // to touch the free text's default-true auto-resize).
  await wrapRow.getByRole("button", { name: "Wrap" }).click();
  const wrappedLabel = await elementById(page, labelId);
  const wrappedText = await elementById(page, freeText.id);
  expect(wrappedLabel.wrap, "the label now wraps").toBe(true);
  expect(wrappedText.autoResize, "the free text now keeps its width").toBe(false);

  // Both flipped the other way, in one click.
  await wrapRow.getByRole("button", { name: "Grow" }).click();
  const grownLabel = await elementById(page, labelId);
  const grownText = await elementById(page, freeText.id);
  expect(grownLabel.wrap, "the label grows its shape").toBe(false);
  expect(grownText.autoResize, "the free text sizes to its glyphs").toBe(true);

  // One undo puts both back to how "Wrap" left them — not just one of the two.
  await focusBoard(board);
  await page.keyboard.press("Control+z");
  const undoneLabel = await elementById(page, labelId);
  const undoneText = await elementById(page, freeText.id);
  expect(undoneLabel.wrap).toBe(wrappedLabel.wrap);
  expect(undoneText.autoResize).toBe(wrappedText.autoResize);
});
