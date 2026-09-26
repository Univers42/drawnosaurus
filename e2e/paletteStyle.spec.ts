import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { openBoard, sceneElements, selection } from "./board.ts";

/**
 * Every style the panel sets is a palette command away (`commandPalette.ts`), with no
 * pointer at all: with a shape selected, Tab is the shape switch's, so the panel itself is
 * out of the keyboard's reach.
 */

const board = (page: Page) => page.locator('.draw-chrome [role="application"]');

async function command(page: Page, query: string): Promise<void> {
  await page.keyboard.press("Control+/");
  await page.keyboard.type(query);
  await page.keyboard.press("Enter");
}

test("the palette styles, recolours and switches a shape, keyboard alone", async ({ page }) => {
  await openBoard(page);
  await board(page).focus();
  await command(page, "add rectangle");
  const [id] = await selection(page);
  const shape = async () => (await sceneElements(page)).find((element) => element.id === id)!;

  // A picker opened from the palette takes its keys as one opened with G does.
  await command(page, "change background color");
  const picker = page.getByRole("dialog", { name: "Background colour picker" });
  await expect(picker).toBeVisible();
  await page.keyboard.press("b"); // red
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  expect((await shape()).backgroundColor).toBe("#ffc9c9");
  await expect(board(page), "the board has the keys back").toBeFocused();

  // A fill style only shows once there is a background to fill, as the panel's row does.
  await command(page, "stroke width: extra bold");
  await command(page, "fill: solid");
  await command(page, "sloppiness: architect");
  await command(page, "edges: sharp");
  const styled = await shape();
  expect([styled.strokeWidth, styled.fillStyle, styled.roughness]).toEqual([4, "solid", 0]);
  expect(styled.roundness ?? null).toBeNull();

  await command(page, "switch shape");
  await expect(page.getByRole("toolbar", { name: "Switch shape" })).toBeVisible();
  await page.keyboard.press("Tab");
  expect((await shape()).type).toBe("diamond");
});
