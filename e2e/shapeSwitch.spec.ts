import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  camera,
  focusBoard,
  openBoard,
  sceneElements,
  selection,
  type SceneElement,
} from "./board.ts";

/**
 * Tab's shape switch (`docs/reference/shapeSwitch.md`), as Excalidraw's
 * `ConvertElementTypePopup` behaves: the first Tab opens it under the selection, each Tab
 * after that switches rectangle → diamond → ellipse and Shift+Tab goes back, and the
 * shape keeps its label and its arrows. `ci_shape_convert.rs` pins the switch itself and
 * `shapeSwitch.test.ts` the keys; this proves the board hands them over.
 */

const panel = (page: Page) => page.getByRole("toolbar", { name: "Switch shape" });
const boardElement = (page: Page) => page.locator('.draw-chrome [role="application"]');
const byId = async (page: Page, id: string): Promise<SceneElement> =>
  (await sceneElements(page)).find((element) => element.id === id)!;

/** A labelled rectangle and a node grown off it with Ctrl+Right, the first one selected. */
async function labelledPair(page: Page): Promise<{ first: string; arrow: string }> {
  await page.keyboard.press("Control+/");
  await page.keyboard.type("add rectangle");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("hello world");
  await page.keyboard.press("Escape");
  const [first] = await selection(page);
  await page.keyboard.press("Control+ArrowRight");
  await page.keyboard.press("Alt+ArrowLeft");
  expect(await selection(page)).toEqual([first]);
  const arrow = (await sceneElements(page)).find((element) => element.type === "arrow")!;
  return { first: first!, arrow: arrow.id };
}

test("Tab opens the switch, then walks the shape round and back, label and arrow kept", async ({
  page,
}) => {
  const board = await openBoard(page);
  await focusBoard(board);
  const { first, arrow } = await labelledPair(page);

  await page.keyboard.press("Tab");
  await expect(panel(page)).toBeVisible();
  expect((await byId(page, first)).type, "the first Tab only opens it").toBe("rectangle");
  await expect(panel(page).getByRole("button", { name: "Rectangle" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const kinds: string[] = [];
  for (const key of ["Tab", "Tab", "Shift+Tab"]) {
    await page.keyboard.press(key);
    kinds.push((await byId(page, first)).type);
  }
  expect(kinds).toEqual(["diamond", "ellipse", "diamond"]);
  await expect(panel(page).getByRole("button", { name: "Diamond" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(boardElement(page), "Tab never left the board").toBeFocused();

  const shape = await byId(page, first);
  const label = await byId(page, shape.boundTextId!);
  expect(label.text).toBe("hello world");
  expect(label.containerId).toBe(first);
  expect((await byId(page, arrow)).startBinding).toBe(first);

  // Hung under the selection's bottom-left corner.
  const at = (await panel(page).boundingBox())!;
  const view = await camera(page);
  const bottom = (shape.y + shape.height) * view.scale + view.y + board.box.y;
  expect(at.y).toBeGreaterThan(bottom);

  // A click picks a type outright, and each switch is one step of undo.
  await panel(page).getByRole("button", { name: "Ellipse" }).click();
  expect((await byId(page, first)).type).toBe("ellipse");
  await page.keyboard.press("Control+z");
  expect((await byId(page, first)).type).toBe("diamond");

  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
});

test("a press on the canvas closes the switch", async ({ page }) => {
  const board = await openBoard(page);
  await focusBoard(board);
  await labelledPair(page);
  await page.keyboard.press("Tab");
  await expect(panel(page)).toBeVisible();
  await focusBoard(board);
  await expect(panel(page)).toHaveCount(0);
});

test("with nothing to switch, Tab moves focus on as it does anywhere", async ({ page }) => {
  const board = await openBoard(page);
  await focusBoard(board);
  await expect(boardElement(page)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(panel(page)).toHaveCount(0);
  await expect(boardElement(page)).not.toBeFocused();
});
