import { expect, test } from "./fixtures.ts";
import {
  OPEN_CANVAS,
  activeTool,
  openBoard,
  pickTool,
  regionInk,
  sceneElements,
  selection,
  type Board,
} from "./board.ts";

/**
 * A closed line as a filled polygon, through a real browser.
 *
 * The geometry, the flag and the fill/hit-test rules are pinned at the engine level
 * (`ci_polygon.rs`, `ci_line_multipoint.rs`, `ci_handles.rs`). This is the half those
 * cannot reach: real clicks closing a loop, a background actually picked from the panel,
 * a click landing inside the paint, the panel's toggle, what undo and redo cross, and
 * what survives export.
 *
 * A selected polygon offers a circle on each vertex under its box, as the oracle does,
 * so a vertex is dragged on its own and the box still resizes the whole
 * (`ci_handles.rs`, `ci_curved_linear.rs`).
 */

const START = { x: OPEN_CANVAS.left + 120, y: OPEN_CANVAS.top + 120 };

function at(board: Board, x: number, y: number): { x: number; y: number } {
  return { x: board.box.x + x, y: board.box.y + y };
}

async function place(board: Board, x: number, y: number): Promise<void> {
  const target = at(board, x, y);
  await board.page.mouse.move(target.x, target.y, { steps: 6 });
  await board.page.mouse.click(target.x, target.y);
  await board.page.waitForTimeout(60);
}

async function theLine(board: Board) {
  const lines = (await sceneElements(board.page)).filter((el) => el.type === "line");
  expect(lines.length, "expected exactly one line on the board").toBe(1);
  return lines[0]!;
}

/** Draws a triangle and closes it back onto its own first point. */
async function drawTriangle(board: Board): Promise<void> {
  await pickTool(board.page, "Line");
  await place(board, START.x, START.y);
  await place(board, START.x + 220, START.y);
  await place(board, START.x + 110, START.y + 180);
  // Back onto the first point, near enough to read as closed.
  await place(board, START.x + 2, START.y + 2);
  await board.page.waitForTimeout(120);
}

/** Opens the background picker for the current selection and picks yellow. */
async function pickYellowBackground(board: Board): Promise<void> {
  const { page } = board;
  await page.keyboard.press("g");
  await expect(page.getByRole("dialog", { name: "Background colour picker" })).toBeVisible();
  // Grid hotkeys are transparent,white,gray,black,bronze,cyan,blue,violet,grape,pink,
  // green,teal,yellow,... — "c" is the thirteenth, yellow (`colors.ts` › `COLOR_HOTKEYS`).
  await page.keyboard.press("c");
  await page.keyboard.press("Escape");
}

const polygonToggle = (board: Board) =>
  board.page.getByRole("button", { name: /^Close shape into a filled polygon/ });

test.describe("a closed line as a filled polygon", () => {
  test("closes into a polygon on its first point while drawing", async ({ page }) => {
    const board = await openBoard(page);
    await drawTriangle(board);

    const line = await theLine(board);
    expect(line.points?.length, "three vertices plus the point that closed the loop").toBe(4);
    expect(line.polygon, "closing on the first point makes it a polygon").toBe(true);
    expect(await activeTool(page), "the tool settles once the shape is closed").toBe("select");
  });

  test("fills once a background is picked, and a click inside then selects it", async ({
    page,
  }) => {
    const board = await openBoard(page);
    await drawTriangle(board);
    // Still selected: drawing leaves the just-finished shape selected.
    await pickYellowBackground(board);

    const filled = await theLine(board);
    expect(filled.backgroundColor).toBe("#ffec99");

    // Deselect with a click on open canvas, then click well inside the triangle — away
    // from every edge, where only a filled shape is hit at all.
    await page.mouse.click(board.box.x + START.x - 60, board.box.y + START.y - 60);
    expect(await selection(page)).toEqual([]);

    const inside = at(board, START.x + 110, START.y + 90);
    await page.mouse.click(inside.x, inside.y);
    expect(await selection(page), "the interior of a filled polygon is a hit target").toEqual([
      filled.id,
    ]);
  });

  test("a rounded polygon's hatching fills its curve, not the triangle of its points", async ({
    page,
  }) => {
    const board = await openBoard(page);
    await drawTriangle(board);
    await pickYellowBackground(board);
    await page.mouse.click(board.box.x + START.x - 60, board.box.y + START.y - 60);
    await page.waitForTimeout(120);
    const line = await theLine(board);
    expect(line.roundness, "rounded by default, so drawn as a curve").toBeTruthy();
    expect(line.fillStyle).toBe("hachure");

    // The right edge runs from (220, 0) to (110, 180). At y = 101 it is at x ≈ 158 and
    // the curve bows out to x ≈ 186: x = 175 is inside the paint, outside the triangle.
    const patch = (x: number, y: number) => ({
      left: START.x + x - 6,
      top: START.y + y - 6,
      right: START.x + x + 6,
      bottom: START.y + y + 6,
    });
    expect(await regionInk(page, patch(175, 101)), "hatched inside the bulge").toBeGreaterThan(
      0.02,
    );
    expect(await regionInk(page, patch(205, 101)), "and nothing beyond the curve").toBe(0);
  });

  test("a vertex of the selected polygon is dragged on its own", async ({ page }) => {
    const board = await openBoard(page);
    await drawTriangle(board);
    const before = await theLine(board);
    expect(await selection(page), "drawing leaves it selected").toEqual([before.id]);

    const from = at(board, START.x + 220, START.y);
    const to = at(board, START.x + 260, START.y - 40);
    await page.mouse.move(from.x, from.y, { steps: 4 });
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(120);

    const after = await theLine(board);
    const world = (el: typeof after) => el.points!.map((p) => [el.x + p[0]!, el.y + p[1]!]);
    const was = world(before);
    const now = world(after);
    expect(now[1], "the vertex followed the pointer").toEqual([START.x + 260, START.y - 40]);
    expect(now[0], "the others stayed").toEqual(was[0]);
    expect(now[2]).toEqual(was[2]);
    expect(after.polygon, "still closed").toBe(true);
  });

  test("the panel's toggle opens and closes it, clearing the fill only on open", async ({
    page,
  }) => {
    const board = await openBoard(page);
    await drawTriangle(board);
    await pickYellowBackground(board);

    const toggle = polygonToggle(board);
    await expect(toggle, "every eligible selected line already is one").toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await toggle.click();
    await page.waitForTimeout(60);
    let line = await theLine(board);
    expect(line.polygon, "opened").toBe(false);
    expect(line.backgroundColor, "opening clears the fill (actionLinearEditor.tsx:159-164)").toBe(
      "transparent",
    );
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    await toggle.click();
    await page.waitForTimeout(60);
    line = await theLine(board);
    expect(line.polygon, "closed again").toBe(true);
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  test("undo and redo cross the toggle", async ({ page }) => {
    const board = await openBoard(page);
    await drawTriangle(board);
    await pickYellowBackground(board);

    await polygonToggle(board).click();
    await page.waitForTimeout(60);
    expect((await theLine(board)).polygon, "opened").toBe(false);

    await page.keyboard.press("Control+z");
    await page.waitForTimeout(60);
    let line = await theLine(board);
    expect(line.polygon, "undo restores the closed polygon").toBe(true);
    expect(line.backgroundColor, "and the fill undo put back").toBe("#ffec99");

    await page.keyboard.press("Control+Shift+z");
    await page.waitForTimeout(60);
    line = await theLine(board);
    expect(line.polygon, "redo opens it again").toBe(false);
  });

  test("resizing a closed polygon by its box keeps its points closed", async ({ page }) => {
    const board = await openBoard(page);
    await drawTriangle(board);
    const before = await theLine(board);
    const firstBefore = before.points![0]!;
    const lastBefore = before.points![before.points!.length - 1]!;
    expect(firstBefore, "closed before the resize").toEqual(lastBefore);

    // The south-east handle sits past the bounding box's corner.
    const handle = at(board, before.x + before.width + 8, before.y + before.height + 8);
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(handle.x + 90, handle.y + 70, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(60);

    const after = await theLine(board);
    expect(after.width, "the resize actually did something").toBeGreaterThan(before.width + 40);
    expect(after.polygon, "still a polygon").toBe(true);
    const firstAfter = after.points![0]!;
    const lastAfter = after.points![after.points!.length - 1]!;
    expect(firstAfter, "still closed after the resize").toEqual(lastAfter);
  });

  test("a closed polygon exports as a filled SVG polygon, not a bare stroke", async ({ page }) => {
    const board = await openBoard(page);
    await drawTriangle(board);
    await pickYellowBackground(board);

    const svg = await page.evaluate(() => {
      const engine = window.__drawEngine as unknown as {
        exportSvg(padding?: number): string | null;
      };
      return engine.exportSvg();
    });
    expect(svg, "the engine should produce an SVG").not.toBeNull();
    expect(svg).toContain("<polygon");
    expect(svg).toContain('fill="#ffec99"');
  });
});
