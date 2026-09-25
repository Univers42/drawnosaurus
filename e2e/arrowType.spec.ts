import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { OPEN_CANVAS, openBoard, pickTool, sceneElements, type Board } from "./board.ts";
import type { BoardElement } from "./textBoard.ts";

/**
 * The arrow rows: sharp or curved (`actionChangeArrowType`,
 * `actionProperties.tsx@1118751f:2057-2242` — the elbow is a recorded gap), and the
 * heads, which with nothing selected are the next arrow's (`currentItemStartArrowhead`,
 * `currentItemEndArrowhead`, `:1944-1982`).
 */

const panel = (page: Page) => page.getByRole("complementary", { name: "Style inspector" });
const arrowType = (page: Page) => panel(page).getByRole("radiogroup", { name: "Arrow type" });

async function drawArrow(board: Board, tool: string, row: number): Promise<BoardElement> {
  const { page, box } = board;
  const before = (await sceneElements(page)).length;
  await pickTool(page, tool);
  const y = box.y + OPEN_CANVAS.top + 60 + row * 70;
  await page.mouse.move(box.x + OPEN_CANVAS.left + 80, y);
  await page.mouse.down();
  await page.mouse.move(box.x + OPEN_CANVAS.left + 320, y + 30, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await sceneElements(page)).length).toBe(before + 1);
  return (await sceneElements(page)).at(-1) as BoardElement;
}

test("the arrow type is the next arrow's, and a selected arrow's", async ({ page }) => {
  const board = await openBoard(page);
  await pickTool(page, "Arrow");
  await expect(arrowType(page).getByRole("radio", { name: "Curved arrow" })).toBeChecked();
  // Arrows take their curve from this row alone, as the oracle's do.
  await expect(panel(page).getByRole("group", { name: "Edges" })).toHaveCount(0);

  await arrowType(page).getByRole("radio", { name: "Sharp arrow" }).click();
  const sharp = await drawArrow(board, "Arrow", 0);
  expect(sharp.roundness ?? null).toBeNull();
  await expect(arrowType(page).getByRole("radio", { name: "Sharp arrow" })).toBeChecked();

  await arrowType(page).getByRole("radio", { name: "Curved arrow" }).click();
  await expect
    .poll(async () => (await sceneElements(page)).find((each) => each.id === sharp.id)?.roundness)
    .not.toBeNull();
  const curved = await drawArrow(board, "Arrow", 1);
  expect(curved.roundness ?? null).not.toBeNull();
});

test("heads chosen with nothing selected are the next arrows', and never a line's", async ({
  page,
}) => {
  const board = await openBoard(page);
  await pickTool(page, "Arrow");
  await panel(page).getByRole("radio", { name: "Start Triangle" }).click();
  await panel(page).getByRole("radio", { name: "End Dot" }).click();

  for (const row of [0, 1]) {
    const arrow = await drawArrow(board, "Arrow", row);
    expect(arrow).toMatchObject({ startArrowhead: "triangle", endArrowhead: "dot" });
  }
  const line = await drawArrow(board, "Line", 2);
  expect(line.startArrowhead ?? null).toBeNull();
  expect(line.endArrowhead ?? null).toBeNull();
});
