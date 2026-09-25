import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { OPEN_CANVAS, focusBoard, openBoard, sceneElements } from "./board.ts";
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
