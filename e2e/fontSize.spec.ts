import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { OPEN_CANVAS, focusBoard, openBoard, sceneElements, type Board } from "./board.ts";
import { clickOn, editor, element, writeText } from "./textBoard.ts";

/**
 * The font size: the oracle's four presets, a typed size (a divergence addition), and
 * Ctrl/Cmd+Shift+< and > a tenth down and up (`actionProperties.tsx@1118751f:1095-1141`)
 * — on the board, and in the text being typed (`wysiwyg/textWysiwyg.tsx@1118751f:675-678`).
 */

const AT = { x: OPEN_CANVAS.left + 120, y: OPEN_CANVAS.top + 120 };

const panel = (page: Page) => page.getByRole("complementary", { name: "Style inspector" });
const sizeField = (page: Page) =>
  panel(page).getByRole("spinbutton", { name: "Font size in pixels" });
const quickPicks = (page: Page) => panel(page).getByRole("radiogroup", { name: "Font family" });

/** The editor's box in world units, and the one the engine laid the text out in. */
async function editorWidths(board: Board): Promise<{ editor: number; engine: number }> {
  const editorWidth = await editor(board).evaluate((node) => parseFloat(node.style.width));
  const engineWidth = await board.page.evaluate(() => {
    const engine = window.__drawEngine as unknown as {
      textEditLayout(): { width: number } | null;
    };
    return engine.textEditLayout()?.width ?? Number.NaN;
  });
  return { editor: editorWidth, engine: engineWidth };
}

/**
 * While a text is typed, the size chords and a family picked from the panel restyle it —
 * the editor takes the new size, family and width at once — and none is a step of its
 * own: the edit, typing and styles together, is one step of undo (DECISIONS, wave 3).
 */
async function restyleWhileTyping(board: Board): Promise<void> {
  const { page } = board;
  const before = await editorWidths(board);
  for (const size of ["22px", "24px"]) {
    await page.keyboard.press("Control+Shift+>");
    await expect(editor(board)).toHaveCSS("font-size", size);
    const widths = await editorWidths(board);
    expect(widths.editor).toBeCloseTo(widths.engine, 3);
  }
  expect((await editorWidths(board)).engine).toBeGreaterThan(before.engine);
  // A quick pick keeps the typing going.
  await quickPicks(page).getByRole("radio", { name: "Code" }).click();
  await expect(editor(board)).toBeFocused();
  await expect(editor(board)).toHaveCSS("font-family", /Comic Shanns/);
  const widths = await editorWidths(board);
  expect(widths.editor).toBeCloseTo(widths.engine, 3);
  // Any other row too: the stroke colour's swatch.
  await panel(page).getByRole("button", { name: "#e03131", exact: true }).click();
  await expect(editor(board)).toBeFocused();
  await expect(editor(board)).toHaveCSS("color", "rgb(224, 49, 49)");
  await page.keyboard.type("!");
}

test("the chords step the selected text a tenth up and down", async ({ page }) => {
  const board = await openBoard(page);
  const text = await writeText(board, AT, "steps");
  await clickOn(board, text.id);
  await expect(sizeField(page)).toHaveValue("20");

  await page.keyboard.press("Control+Shift+>");
  await expect.poll(async () => (await element(board, text.id)).fontSize).toBe(22);
  await page.keyboard.press("Control+Shift+>");
  await expect.poll(async () => (await element(board, text.id)).fontSize).toBe(24);
  await page.keyboard.press("Control+Shift+<");
  await expect.poll(async () => (await element(board, text.id)).fontSize).toBe(22);
  await expect(sizeField(page)).toHaveValue("22");
});

test("in the text being typed, the chords step it and the typing is kept", async ({ page }) => {
  const board = await openBoard(page);
  await page.mouse.dblclick(board.box.x + AT.x, board.box.y + AT.y);
  await expect(editor(board)).toBeVisible();
  await page.keyboard.type("abc");

  await page.keyboard.press("Control+Shift+>");
  await expect(editor(board)).toBeVisible();
  await expect(editor(board)).toBeFocused();
  await expect(editor(board)).toHaveValue("abc");
  await expect(editor(board)).toHaveCSS("font-size", "22px");

  // Typing still types: Shift+F and S are letters here, not the pickers' keys.
  await page.keyboard.type("Fs");
  await expect(editor(board)).toHaveValue("abcFs");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.keyboard.press("Control+Enter");
  await expect(editor(board)).toHaveCount(0);
  const [text] = await sceneElements(page);
  expect(text).toMatchObject({ type: "text", text: "abcFs" });
  expect((await element(board, text!.id)).fontSize).toBe(22);

  // Made in one step: undone, nothing is left — no empty text the step committed.
  await focusBoard(board);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await sceneElements(page)).length).toBe(0);
});

test("a size typed into the panel is what the text takes", async ({ page }) => {
  const board = await openBoard(page);
  const text = await writeText(board, AT, "typed");
  // `writeText` leaves the text as the sole selection, and a plain click on that —
  // already the sole selection — reopens it for typing instead of just selecting it
  // (`ci_text_edit.rs` › entry). Deselect first so the click here is a fresh select.
  await focusBoard(board);
  await clickOn(board, text.id);
  await sizeField(page).fill("45");
  await sizeField(page).press("Enter");
  await expect.poll(async () => (await element(board, text.id)).fontSize).toBe(45);
  await expect(
    panel(page).getByRole("group", { name: "Font size" }).locator('[aria-pressed="true"]'),
  ).toHaveCount(0);

  await panel(page)
    .getByRole("group", { name: "Font size" })
    .getByRole("button", { name: "XL" })
    .click();
  await expect.poll(async () => (await element(board, text.id)).fontSize).toBe(36);
  await expect(sizeField(page)).toHaveValue("36");
});

test("a text typed into again takes the chords, a family and a colour in the one step of its edit", async ({
  page,
}) => {
  const board = await openBoard(page);
  const text = await writeText(board, AT, "steps");
  // `writeText` leaves the text as the sole selection, so this plain click reopens it
  // directly, caret at the click — the one entry point that does not select it all, so
  // End is what puts the caret back at the end of the line (`ci_text_edit.rs` › entry).
  await clickOn(board, text.id);
  await expect(editor(board)).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.type(" more");

  await restyleWhileTyping(board);

  await page.keyboard.press("Escape");
  await expect(editor(board)).toHaveCount(0);
  expect(await element(board, text.id)).toMatchObject({
    text: "steps more!",
    fontSize: 24,
    fontFamily: 8,
    strokeColor: "#e03131",
  });
  await focusBoard(board);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await element(board, text.id)).text).toBe("steps");
  expect(await element(board, text.id)).toMatchObject({
    fontSize: 20,
    fontFamily: 5,
    strokeColor: "#1e1e1e",
  });
});

test("a new text takes the chords, a family and a colour in the one step that makes it", async ({
  page,
}) => {
  const board = await openBoard(page);
  await page.mouse.dblclick(board.box.x + AT.x, board.box.y + AT.y);
  await expect(editor(board)).toBeFocused();
  await page.keyboard.type("new");

  await restyleWhileTyping(board);

  await page.keyboard.press("Escape");
  await expect(editor(board)).toHaveCount(0);
  const [text] = await sceneElements(page);
  expect(await element(board, text!.id)).toMatchObject({
    text: "new!",
    fontSize: 24,
    fontFamily: 8,
    strokeColor: "#e03131",
  });
  await focusBoard(board);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await sceneElements(page)).length).toBe(0);
});
