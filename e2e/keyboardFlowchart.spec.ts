import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  openBoard,
  sceneElements,
  selection,
  waitForCameraLanded,
  type SceneElement,
} from "./board.ts";

/**
 * A six-node, coloured flowchart built with the keyboard alone — not one pointer event,
 * the board included, which is focused as Tab would reach it. Every key is one Excalidraw
 * has for it: Ctrl+/ for the palette, Enter to label, G and a letter for a colour,
 * Ctrl+Arrow to grow, Alt+Arrow to walk back, Tab to switch a node's shape, Shift+1 to
 * see it all.
 */

const board = (page: Page) => page.locator('.draw-chrome [role="application"]');
const editor = (page: Page) => page.locator("textarea[aria-label='Text editor']");
const backgroundPicker = (page: Page) =>
  page.getByRole("dialog", { name: "Background colour picker" });

async function label(page: Page, text: string): Promise<void> {
  await page.keyboard.press("Enter");
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type(text);
  await page.keyboard.press("Escape");
  await expect(editor(page)).toHaveCount(0);
}

/** G opens the background picker; a letter picks from its grid (`COLOR_HOTKEYS`, row by row). */
async function colour(page: Page, hotkey: string): Promise<void> {
  await page.keyboard.press("g");
  await expect(backgroundPicker(page)).toBeVisible();
  await page.keyboard.press(hotkey);
  await page.keyboard.press("Escape");
  await expect(backgroundPicker(page)).toHaveCount(0);
  await expect(board(page), "the board has the keys back").toBeFocused();
}

/** Tab opens the shape switch, and each Tab after that moves the shape on by one. */
async function switchTo(page: Page, id: string, type: string): Promise<void> {
  await page.keyboard.press("Tab");
  for (let i = 0; i < 3; i += 1) {
    const now = (await sceneElements(page)).find((element) => element.id === id)!;
    if (now.type === type) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Tab never reached a ${type}`);
}

async function grow(page: Page, key: string): Promise<string> {
  await page.keyboard.press(`Control+${key}`);
  const [id] = await selection(page);
  return id!;
}

test("six coloured nodes and five arrows, from the keyboard alone", async ({ page }, testInfo) => {
  await openBoard(page);
  await board(page).focus();

  await page.keyboard.press("Control+/");
  await page.keyboard.type("add rectangle");
  await page.keyboard.press("Enter");
  const [start] = await selection(page);
  await label(page, "Start");
  await colour(page, "z"); // green

  const check = await grow(page, "ArrowRight");
  await switchTo(page, check, "diamond");
  await label(page, "Valid?");
  await colour(page, "c"); // yellow

  const save = await grow(page, "ArrowRight");
  await switchTo(page, save, "rectangle");
  await label(page, "Save");
  await colour(page, "s"); // blue

  const done = await grow(page, "ArrowRight");
  await switchTo(page, done, "ellipse");
  await label(page, "Done");
  await colour(page, "x"); // teal

  // Back along the arrows to the decision, and down its other branch.
  await page.keyboard.press("Alt+ArrowLeft");
  await page.keyboard.press("Alt+ArrowLeft");
  expect(await selection(page)).toEqual([check]);
  const fix = await grow(page, "ArrowDown");
  await switchTo(page, fix, "rectangle");
  await label(page, "Fix");
  await colour(page, "b"); // red

  const retry = await grow(page, "ArrowDown");
  await label(page, "Retry");
  await colour(page, "v"); // orange

  await page.keyboard.press("Shift+Digit1");
  await waitForCameraLanded(page);

  const scene = (await sceneElements(page)).filter((element) => !element.isDeleted);
  const nodes = [start!, check, save, done, fix, retry];
  const byId = new Map(scene.map((element) => [element.id, element]));
  const node = (id: string): SceneElement => byId.get(id)!;

  expect(nodes.map((id) => node(id).type)).toEqual([
    "rectangle",
    "diamond",
    "rectangle",
    "ellipse",
    "rectangle",
    "rectangle",
  ]);
  expect(nodes.map((id) => byId.get(node(id).boundTextId!)?.originalText)).toEqual([
    "Start",
    "Valid?",
    "Save",
    "Done",
    "Fix",
    "Retry",
  ]);
  // The grid's light shade, as a background picked from it is.
  expect(nodes.map((id) => node(id).backgroundColor)).toEqual([
    "#b2f2bb",
    "#ffec99",
    "#a5d8ff",
    "#96f2d7",
    "#ffc9c9",
    "#ffd8a8",
  ]);

  const arrows = scene.filter((element) => element.type === "arrow");
  expect(arrows.map((arrow) => `${arrow.startBinding}>${arrow.endBinding}`).sort()).toEqual(
    [
      `${start}>${check}`,
      `${check}>${save}`,
      `${save}>${done}`,
      `${check}>${fix}`,
      `${fix}>${retry}`,
    ].sort(),
  );
  expect(scene).toHaveLength(6 + 6 + 5);

  const shot = testInfo.outputPath("flowchart.png");
  await page.screenshot({ path: shot });
  await testInfo.attach("flowchart", { path: shot, contentType: "image/png" });
});
