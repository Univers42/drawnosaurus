import type { Locator } from "@playwright/test";
import { expect } from "./fixtures.ts";
import { sceneElements, type Board, type SceneElement } from "./board.ts";

/**
 * Texts on the board, for the specs about the panel's text rows and the bound-text
 * actions: writing one as a person does, and aiming at one wherever the camera put it.
 */

/** What these specs read of an element beyond `SceneElement`. */
export type BoardElement = SceneElement & {
  fontFamily?: number;
  fontSize?: number;
  autoResize?: boolean;
  startArrowhead?: string | null;
  endArrowhead?: string | null;
};

export const editor = (board: Board): Locator =>
  board.page.locator("textarea[aria-label='Text editor']");

export async function element(board: Board, id: string): Promise<BoardElement> {
  const found = (await sceneElements(board.page)).find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no element ${id}`);
  return found as BoardElement;
}

/** Double-clicks empty board at `at` (canvas pixels), types `words` and commits them. */
export async function writeText(
  board: Board,
  at: { x: number; y: number },
  words: string,
): Promise<BoardElement> {
  const { page, box } = board;
  const before = new Set((await sceneElements(page)).map((existing) => existing.id));
  await page.mouse.dblclick(box.x + at.x, box.y + at.y);
  await expect(editor(board)).toBeVisible();
  await page.keyboard.type(words);
  await page.keyboard.press("Control+Enter");
  await expect(editor(board)).toHaveCount(0);
  const made = (await sceneElements(page)).find(
    (candidate) => candidate.type === "text" && !before.has(candidate.id),
  );
  if (!made) throw new Error("no text was made");
  return made as BoardElement;
}

/**
 * Clicks element `id` — its middle, which is on a text, or its top edge, which is on a
 * shape with a transparent background, hit on its outline only.
 */
export async function clickOn(
  board: Board,
  id: string,
  options: { where?: "middle" | "top"; button?: "left" | "right"; shift?: boolean } = {},
): Promise<void> {
  const { page, box } = board;
  const target = await element(board, id);
  const { x, y, scale } = await page.evaluate(() => window.__drawEngine!.camera);
  const worldY = options.where === "top" ? target.y : target.y + target.height / 2;
  const point = {
    x: box.x + (target.x + target.width / 2) * scale + x,
    y: box.y + worldY * scale + y,
  };
  if (options.shift) await page.keyboard.down("Shift");
  await page.mouse.click(point.x, point.y, { button: options.button ?? "left" });
  if (options.shift) await page.keyboard.up("Shift");
}
