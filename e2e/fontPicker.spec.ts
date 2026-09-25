import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  OPEN_CANVAS,
  expectBesidePanel,
  focusBoard,
  openBoard,
  patchedElements,
  sceneElements,
  selection,
} from "./board.ts";
import { clickOn, editor, element, writeText, type BoardElement } from "./textBoard.ts";

/**
 * The font family row, as Excalidraw's FontPicker (`components/FontPicker/*@1118751f`):
 * three quick picks and a list of the families shipped, the board's own first, searched,
 * walked with the keys, a hovered family shown on the canvas before it is picked — and a
 * family's face loaded before any text is laid out in it.
 */

const AT = { x: OPEN_CANVAS.left + 120, y: OPEN_CANVAS.top + 120 };
const WORDS = "Wide words iiii";

const panel = (page: Page) => page.getByRole("complementary", { name: "Style inspector" });
const quickPicks = (page: Page) => panel(page).getByRole("radiogroup", { name: "Font family" });
const picker = (page: Page) => page.getByRole("dialog", { name: "Font picker" });

/** The width `words` measures at 20px in `family`, on a canvas of its own. */
function measured(page: Page, words: string, family: string): Promise<number> {
  return page.evaluate(
    ({ words, family }) => {
      const probe = document.createElement("canvas").getContext("2d")!;
      probe.font = `20px ${family}`;
      return probe.measureText(words).width;
    },
    { words, family },
  );
}

test("a family picked from the list is loaded, then the text is laid out in it", async ({
  page,
}) => {
  const board = await openBoard(page);
  const text = await writeText(board, AT, WORDS);
  await clickOn(board, text.id);
  await expect(quickPicks(page).getByRole("radio", { name: "Hand-drawn" })).toBeChecked();

  // Whether the face was in when the engine was told: laid out in a fallback first, a
  // label's shape would keep the growth (`actionProperties.tsx@1118751f:1302-1356`).
  await page.evaluate(() => {
    const engine = window.__drawEngine as unknown as { setFontFamily(id: number): void };
    const original = engine.setFontFamily.bind(engine);
    const seen: boolean[] = [];
    (window as unknown as { loadedWhenSet: boolean[] }).loadedWhenSet = seen;
    engine.setFontFamily = (id) => {
      seen.push(document.fonts.check('20px "Lilita One"'));
      original(id);
    };
  });

  await panel(page).getByRole("button", { name: "Show font picker" }).click();
  await expect(picker(page)).toBeVisible();
  const inScene = picker(page).getByRole("group", { name: "In this scene" });
  const available = picker(page).getByRole("group", { name: "Available fonts" });
  await expect(inScene.getByRole("button")).toHaveText(["Excalifont"]);
  // Label order, and none of the deprecated families the board does not use.
  await expect(available.getByRole("button")).toHaveText(["Comic Shanns", "Lilita One", "Nunito"]);

  await available.getByRole("button", { name: "Lilita One" }).click();
  await expect(picker(page)).toBeHidden();
  await expect.poll(async () => (await element(board, text.id)).fontFamily).toBe(7);
  expect(
    await page.evaluate(() => (window as unknown as { loadedWhenSet: boolean[] }).loadedWhenSet),
    "laid out before its face was in",
  ).toEqual([true]);
  const lilita = await measured(page, WORDS, '"Lilita One"');
  expect(Math.abs(lilita - (await measured(page, WORDS, "sans-serif")))).toBeGreaterThan(1);
  expect((await element(board, text.id)).width).toBeCloseTo(lilita, 0);
});

test("the list opens beside the panel and leaves the panel as it was", async ({ page }) => {
  const board = await openBoard(page);
  const text = await writeText(board, AT, WORDS);
  await clickOn(board, text.id);
  await panel(page).getByRole("button", { name: "Show font picker" }).click();
  await expect(picker(page)).toBeVisible();
  await expect(picker(page).getByRole("textbox", { name: "Quick search" })).toBeFocused();
  await expectBesidePanel(page, picker(page));
});

test("the list is searched and walked from the keyboard, and shows a family before it is picked", async ({
  page,
}) => {
  const board = await openBoard(page);
  const text = await writeText(board, AT, WORDS);
  // `writeText` leaves the text as the sole selection, and a plain click on that —
  // already the sole selection — reopens it for typing instead of just selecting it
  // (`ci_text_edit.rs` › entry), which would swallow Shift+F below as a letter typed.
  // Deselect first so the click here is a fresh select.
  await focusBoard(board);
  await clickOn(board, text.id);

  // Shift+F opens it, on the search (`App.tsx@1118751f:5921-5950`).
  await page.keyboard.press("Shift+F");
  await expect(picker(page)).toBeVisible();
  await expect(picker(page).getByRole("textbox", { name: "Quick search" })).toBeFocused();

  // A search hovers the first family it finds, and the canvas shows it.
  await page.keyboard.type("nun");
  await expect(picker(page).locator('[data-hovered="true"]')).toHaveText("Nunito");
  await expect.poll(async () => (await element(board, text.id)).fontFamily).toBe(6);
  await expect(quickPicks(page).getByRole("radio", { name: "Hand-drawn" })).toBeChecked();
  await page.keyboard.type("zz");
  await expect(picker(page)).toContainText("No fonts found");
  await expect.poll(async () => (await element(board, text.id)).fontFamily).toBe(5);

  // Escape takes the preview back and commits nothing.
  await page.keyboard.press("Escape");
  await expect(picker(page)).toBeHidden();
  expect((await element(board, text.id)).fontFamily).toBe(5);
  const sent = await patchedElements(page);
  expect(sent.some((each) => (each as BoardElement).fontFamily === 6)).toBe(false);

  // The arrows walk on from the family chosen: Excalifont, the board's, is first.
  await page.keyboard.press("Shift+F");
  await expect(picker(page)).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(picker(page).locator('[data-hovered="true"]')).toHaveText("Comic Shanns");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(picker(page).locator('[data-hovered="true"]')).toHaveText("Nunito");
  await page.keyboard.press("Enter");
  await expect(picker(page)).toBeHidden();
  await expect.poll(async () => (await element(board, text.id)).fontFamily).toBe(6);
  expect(await selection(page)).toEqual([text.id]);
});

test("a selection of two families checks neither, and a pick sets both", async ({ page }) => {
  const board = await openBoard(page);
  const first = await writeText(board, AT, "one");
  const second = await writeText(board, { x: AT.x, y: AT.y + 140 }, "two");
  await clickOn(board, second.id);
  await quickPicks(page).getByRole("radio", { name: "Normal" }).click();
  await expect.poll(async () => (await element(board, second.id)).fontFamily).toBe(6);

  await focusBoard(board);
  await page.keyboard.press("Control+a");
  await expect.poll(async () => (await selection(page)).length).toBe(2);
  await expect(quickPicks(page).getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(panel(page).getByRole("button", { name: "Show font picker" })).toHaveAttribute(
    "title",
    "Font family: mixed",
  );

  await quickPicks(page).getByRole("radio", { name: "Code" }).click();
  await expect.poll(async () => (await element(board, first.id)).fontFamily).toBe(8);
  expect((await element(board, second.id)).fontFamily).toBe(8);
  await expect(quickPicks(page).getByRole("radio", { name: "Code" })).toBeChecked();
});

test("a family picked while typing is the one the editor types in", async ({ page }) => {
  const board = await openBoard(page);
  await page.mouse.dblclick(board.box.x + AT.x, board.box.y + AT.y);
  await expect(editor(board)).toBeVisible();
  await page.keyboard.type("abc");
  await expect(editor(board)).toHaveCSS("font-family", /Excalifont/);

  // The quick picks keep the focus, so the editor stays open and takes the new face.
  await quickPicks(page).getByRole("radio", { name: "Code" }).click();
  await expect(editor(board)).toBeFocused();
  await expect(editor(board)).toHaveCSS("font-family", /Comic Shanns/);
  await expect(editor(board)).toHaveValue("abc");

  await page.keyboard.press("Control+Enter");
  await expect(editor(board)).toHaveCount(0);
  const [text] = await sceneElements(page);
  expect(text).toMatchObject({ type: "text", text: "abc", fontFamily: 8 });
});

test("a family picked from the list while typing gives the keys back to the typing", async ({
  page,
}) => {
  const board = await openBoard(page);
  await page.mouse.dblclick(board.box.x + AT.x, board.box.y + AT.y);
  await expect(editor(board)).toBeFocused();
  await page.keyboard.type("abc");

  // The list takes the keys while it is open; once a family is picked, the editor has
  // them again, as the oracle's takes the focus back (`textWysiwyg.tsx@1118751f:1008-1016`).
  await panel(page).getByRole("button", { name: "Show font picker" }).click();
  await expect(picker(page)).toBeVisible();
  await picker(page).getByRole("button", { name: "Nunito" }).hover();
  await picker(page).getByRole("button", { name: "Nunito" }).click();
  await expect(picker(page)).toBeHidden();
  await expect(editor(board)).toBeFocused();
  await page.keyboard.type("de");
  await expect(editor(board)).toHaveValue("abcde");

  await page.keyboard.press("Control+Enter");
  const [text] = await sceneElements(page);
  expect(text).toMatchObject({ type: "text", text: "abcde", fontFamily: 6 });
});

test("a family only hovered while typing is not the one a press on the board commits", async ({
  page,
}) => {
  const board = await openBoard(page);
  await page.mouse.dblclick(board.box.x + AT.x, board.box.y + AT.y);
  await expect(editor(board)).toBeFocused();
  await page.keyboard.type("abc");

  // The search hovers Nunito: the editor shows it, nothing is picked.
  await panel(page).getByRole("button", { name: "Show font picker" }).click();
  await expect(picker(page)).toBeVisible();
  // Every face the list is shown in has arrived, and Nunito's, before the hover: no face
  // arriving afterwards restyles the editor, so the hover itself has to.
  await page.evaluate(async () => {
    await document.fonts.load("10px Nunito");
    await document.fonts.ready;
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
  await page.keyboard.type("nun");
  await expect(picker(page).locator('[data-hovered="true"]')).toHaveText("Nunito");
  await expect(editor(board)).toHaveCSS("font-family", /Nunito/);

  // A press on the board ends the edit before the list closes: the hover is given back
  // first, as the oracle's picker puts back what it cached (`actionProperties.tsx@1118751f:
  // 1483-1500`), rather than committed with the words.
  await page.mouse.click(
    board.box.x + OPEN_CANVAS.right - 60,
    board.box.y + OPEN_CANVAS.bottom - 60,
  );
  await expect(editor(board)).toHaveCount(0);
  await expect(picker(page)).toBeHidden();
  const [text, ...others] = await sceneElements(page);
  expect(others).toEqual([]);
  expect(text).toMatchObject({ type: "text", text: "abc", fontFamily: 5 });
  await expect
    .poll(async () => (await patchedElements(page)).some((each) => each.id === text!.id))
    .toBe(true);
  const sent = await patchedElements(page);
  expect(sent.some((each) => (each as BoardElement).fontFamily === 6)).toBe(false);
});
