import { expect, test } from "./fixtures.ts";
import {
  OPEN_CANVAS,
  focusBoard,
  openBoard,
  pickTool,
  sceneElements,
  selection,
  type Board,
} from "./board.ts";
import { clickOn, element, writeText, type BoardElement } from "./textBoard.ts";

/**
 * The context menu's bound-text actions (`actions/actionBoundText.tsx@1118751f`): a text
 * bound into a shape, a label given back, a text wrapped in a new shape — each one step
 * of undo, and each offered only where it applies.
 */

const BOX = { x: OPEN_CANVAS.left + 80, y: OPEN_CANVAS.top + 60, width: 220, height: 120 };
const TEXT_AT = { x: OPEN_CANVAS.left + 420, y: OPEN_CANVAS.top + 300 };

async function drawBox(board: Board): Promise<BoardElement> {
  const { page, box } = board;
  await pickTool(page, "Rectangle");
  await page.mouse.move(box.x + BOX.x, box.y + BOX.y);
  await page.mouse.down();
  await page.mouse.move(box.x + BOX.x + BOX.width, box.y + BOX.y + BOX.height, { steps: 4 });
  await page.mouse.up();
  const [shape] = await sceneElements(page);
  return shape as BoardElement;
}

const TEXT_ITEMS = [
  "Enable text auto-resizing",
  "Unbind text",
  "Bind text to the container",
  "Wrap text in a container",
];

/** The text entries the element menu offers, in its order. */
async function textItems(board: Board): Promise<string[]> {
  const items = await board.page.getByRole("menuitem").allInnerTexts();
  return items.map((item) => item.trim()).filter((item) => TEXT_ITEMS.includes(item));
}

async function run(board: Board, item: string): Promise<void> {
  await board.page.getByRole("menuitem", { name: item, exact: true }).click();
  await expect(board.page.getByRole("menu")).toBeHidden();
}

test("a text is bound into a shape, and given back where it is drawn", async ({ page }) => {
  const board = await openBoard(page);
  const shape = await drawBox(board);
  const text = await writeText(board, TEXT_AT, "inside");

  // The shape first, then the text added with Shift: `writeText` leaves the text as the
  // sole selection, and a plain click on that — already the sole selection — reopens it
  // for typing instead of just selecting it (`ci_text_edit.rs` › entry).
  await clickOn(board, shape.id, { where: "top" });
  await clickOn(board, text.id, { shift: true });
  await expect.poll(async () => (await selection(page)).length).toBe(2);
  // The menu acts on the selection the pointer is on, all of it.
  await clickOn(board, text.id, { button: "right" });
  expect(await textItems(board)).toEqual([
    "Bind text to the container",
    "Wrap text in a container",
  ]);
  await run(board, "Bind text to the container");

  const label = await element(board, text.id);
  expect(label.containerId).toBe(shape.id);
  expect((await element(board, shape.id)).boundTextId).toBe(text.id);
  expect(await selection(page)).toEqual([shape.id]);
  expect(label.x + label.width / 2).toBeCloseTo(shape.x + shape.width / 2, 0);
  expect(label.y + label.height / 2).toBeCloseTo(shape.y + shape.height / 2, 0);
  // Directly above its shape.
  expect((await sceneElements(page)).map((each) => each.id)).toEqual([shape.id, text.id]);

  // On the words, in the middle of a transparent shape: a label is part of its shape to
  // the menu's hit (`App.tsx@1118751f:6725-6735`), so the shape stays what is selected.
  await clickOn(board, text.id, { button: "right" });
  expect(await selection(page)).toEqual([shape.id]);
  expect(await textItems(board)).toEqual(["Unbind text"]);
  await run(board, "Unbind text");
  const freed = await element(board, text.id);
  expect(freed.containerId ?? null).toBeNull();
  expect((await element(board, shape.id)).boundTextId ?? null).toBeNull();
  // Where it was drawn, and the shape at its own height again.
  expect(freed.x).toBeCloseTo(label.x, 0);
  expect(freed.y).toBeCloseTo(label.y, 0);
  expect((await element(board, shape.id)).height).toBeCloseTo(shape.height, 0);

  await focusBoard(board);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await element(board, text.id)).containerId).toBe(shape.id);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await element(board, text.id)).containerId ?? null).toBeNull();
});

test("a text is wrapped in a new shape, in one step", async ({ page }) => {
  const board = await openBoard(page);
  const text = await writeText(board, TEXT_AT, "wrapped");

  await clickOn(board, text.id, { button: "right" });
  expect(await textItems(board)).toEqual(["Wrap text in a container"]);
  await run(board, "Wrap text in a container");

  const elements = await sceneElements(page);
  expect(elements.map((each) => each.type)).toEqual(["rectangle", "text"]);
  const [shape, label] = elements as [BoardElement, BoardElement];
  expect(shape.boundTextId).toBe(text.id);
  expect(label.containerId).toBe(shape.id);
  expect(await selection(page)).toEqual([shape.id]);
  // Clear of the text all round.
  expect(shape.x).toBeLessThan(label.x);
  expect(shape.y).toBeLessThan(label.y);
  expect(shape.x + shape.width).toBeGreaterThan(label.x + label.width);
  expect(shape.y + shape.height).toBeGreaterThan(label.y + label.height);

  await focusBoard(board);
  await page.keyboard.press("Control+z");
  await expect
    .poll(async () => (await sceneElements(page)).map((each) => each.type))
    .toEqual(["text"]);
  expect((await element(board, text.id)).containerId ?? null).toBeNull();
});

test("a shape alone is offered none of them", async ({ page }) => {
  const board = await openBoard(page);
  const shape = await drawBox(board);
  await clickOn(board, shape.id, { where: "top", button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  expect(await textItems(board)).toEqual([]);
});
