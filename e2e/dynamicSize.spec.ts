import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { activeTool, focusBoard, openBoard, sceneElements, type Board } from "./board.ts";

/**
 * Dynamic size (`docs/reference/dynamic-size.md`): drawn zoomed out, a stroke is as thick
 * on screen as it would be at 100%. On by default, the owner's call; the main menu's
 * switch turns it off, and the choice is kept per browser.
 *
 * The engine proves the look (`ci_dynamic_size.rs`); this proves the chrome: the
 * preference reaches the engine at start-up, the switch reaches it at once, and a
 * reload keeps it.
 */

async function zoomTo(page: Page, scale: number): Promise<void> {
  await page.evaluate((target) => {
    const engine = window.__drawEngine!;
    engine.zoomAt(0, 0, target / engine.camera.scale);
  }, scale);
}

/** A freehand stroke across the open canvas, `dy` below the first. */
async function stroke(board: Board, dy: number): Promise<void> {
  const { page, box } = board;
  const [x, y] = [box.x + 300, box.y + 250 + dy];
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step++) {
    await page.mouse.move(x + step * 25, y + Math.sin(step) * 20);
  }
  await page.mouse.up();
}

function dynamicSizeSwitch(page: Page) {
  return page.getByRole("switch", { name: "Dynamic size" });
}

test("a stroke drawn at 10% is ten times its key, until the switch turns it off", async ({
  page,
}) => {
  const board = await openBoard(page);
  await focusBoard(board);
  await zoomTo(page, 0.1);
  await page.keyboard.press("x");
  expect(await activeTool(page)).toBe("freedraw");

  await stroke(board, 0);
  const [scaled] = await sceneElements(page);
  expect(scaled?.type).toBe("freedraw");
  expect(scaled?.sizeScale).toBe(10);

  await page.getByRole("button", { name: "Open main menu" }).click();
  await expect(dynamicSizeSwitch(page)).toHaveAttribute("aria-checked", "true");
  await dynamicSizeSwitch(page).click();
  await expect(dynamicSizeSwitch(page)).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Escape");
  await expect(dynamicSizeSwitch(page)).toBeHidden();

  await stroke(board, 120);
  const elements = await sceneElements(page);
  expect(elements).toHaveLength(2);
  const plain = elements[1];
  expect(plain?.sizeScale).toBeUndefined();
  expect(scaled?.strokeWidth).toBe((plain?.strokeWidth ?? 0) * 10);
});

test("the switch is kept across a reload, and reaches the engine there", async ({ page }) => {
  await openBoard(page);
  await page.getByRole("button", { name: "Open main menu" }).click();
  await dynamicSizeSwitch(page).click();
  await expect(dynamicSizeSwitch(page)).toHaveAttribute("aria-checked", "false");

  await page.reload();
  await page.waitForFunction(() => window.__drawEngine !== undefined);
  expect(await page.evaluate(() => window.__drawEngine!.dynamicSize())).toBe(false);
  await page.getByRole("button", { name: "Open main menu" }).click();
  await expect(dynamicSizeSwitch(page)).toHaveAttribute("aria-checked", "false");
});
