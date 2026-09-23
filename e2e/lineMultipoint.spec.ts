import { expect, test } from "./fixtures.ts";
import {
  OPEN_CANVAS,
  activeTool,
  focusBoard,
  openBoard,
  pickTool,
  sceneElements,
  selection,
  type Board,
} from "./board.ts";

/**
 * Drawing a line point by point, in a real browser.
 *
 * `ci_line_multipoint.rs` pins the rules; this checks a real pointer reaches them, and
 * the two are not redundant. The engine test calls `begin_pointer`/`move_pointer`
 * directly, so it cannot see the thing most likely to break here: a path follows the
 * cursor **between** its clicks, and the canvas used to drop every pointer move that
 * arrived with no button held. A fix that never reached the host would pass the engine
 * test and leave the tool unusable.
 */

/** Canvas-relative, well clear of every floating panel. */
const START = { x: OPEN_CANVAS.left + 120, y: OPEN_CANVAS.top + 120 };

function at(board: Board, x: number, y: number): { x: number; y: number } {
  return { x: board.box.x + x, y: board.box.y + y };
}

/** Moves to a point and clicks it, which is how a point is placed. */
async function place(board: Board, x: number, y: number): Promise<void> {
  const target = at(board, x, y);
  // In steps, so the engine sees a cursor crossing the commit zone rather than
  // teleporting past it — the preview point only appears once the cursor has left.
  await board.page.mouse.move(target.x, target.y, { steps: 6 });
  await board.page.mouse.click(target.x, target.y);
  await board.page.waitForTimeout(60);
}

async function theLine(board: Board) {
  const lines = (await sceneElements(board.page)).filter((el) => el.type === "line");
  expect(lines.length, "expected exactly one line on the board").toBe(1);
  return lines[0]!;
}

/** The line's points, with the "has any" check done once rather than at every index. */
async function thePoints(board: Board): Promise<[number, number][]> {
  const points = (await theLine(board)).points ?? [];
  expect(points.length, "the line should have points").toBeGreaterThan(0);
  return points;
}

test.describe("placing a line point by point", () => {
  test("takes a point per click and keeps the tool until it is finished", async ({ page }) => {
    const board = await openBoard(page);
    await pickTool(page, "Line");

    await place(board, START.x, START.y);
    await place(board, START.x + 220, START.y);
    await place(board, START.x + 220, START.y + 160);

    expect(
      await activeTool(page),
      "the tool must stay put while the path is still being placed",
    ).toBe("line");

    // Clicking the point just placed ends it — which is also what the second click of a
    // double click lands on.
    const last = at(board, START.x + 220, START.y + 160);
    await page.mouse.click(last.x, last.y);
    await page.waitForTimeout(120);

    expect((await thePoints(board)).length, "three points placed, no preview kept").toBe(3);
    expect(await activeTool(page), "the tool settles once the path is done").toBe("select");
    expect(await selection(page)).toHaveLength(1);
  });

  /**
   * The host-side half, and the reason this file exists. If hover moves are dropped the
   * path never grows a preview, so the second click lands inside the first point's commit
   * zone and ends the path immediately — leaving one point, which is thrown away.
   */
  test("follows the cursor between clicks", async ({ page }) => {
    const board = await openBoard(page);
    await pickTool(page, "Line");

    await place(board, START.x, START.y);
    const away = at(board, START.x + 260, START.y + 40);
    await page.mouse.move(away.x, away.y, { steps: 8 });
    await page.waitForTimeout(80);

    expect(
      (await thePoints(board)).length,
      "a preview segment should be following the cursor",
    ).toBe(2);
  });

  test("closes into a shape when it comes back to where it started", async ({ page }) => {
    const board = await openBoard(page);
    await pickTool(page, "Line");

    await place(board, START.x, START.y);
    await place(board, START.x + 240, START.y);
    await place(board, START.x + 240, START.y + 180);
    // Back onto the first point, near enough to read as closed.
    await place(board, START.x + 2, START.y + 2);
    await page.waitForTimeout(120);

    const points = await thePoints(board);
    expect(points.length, "four points, the last one closing the loop").toBe(4);
    const [first, last] = [points[0]!, points[points.length - 1]!];
    expect(
      Math.hypot(first[0] - last[0], first[1] - last[1]),
      "the loop is shut exactly, not to within a few pixels — a gap of two at this zoom " +
        "is two hundred at the next one",
    ).toBeCloseTo(0, 6);
    expect(await activeTool(page)).toBe("select");
  });

  test("is finished by Escape, keeping what was placed", async ({ page }) => {
    const board = await openBoard(page);
    // Focused *first*. `focusBoard` focuses by clicking the canvas, and while a path is
    // open a click anywhere places a point — so focusing afterwards would quietly add a
    // fourth one in the corner and this would be measuring that instead.
    await focusBoard(board);
    await pickTool(page, "Line");

    await place(board, START.x, START.y);
    await place(board, START.x + 200, START.y);
    await place(board, START.x + 200, START.y + 140);
    // A preview left hanging, which must not be kept.
    const hanging = at(board, START.x + 340, START.y + 260);
    await page.mouse.move(hanging.x, hanging.y, { steps: 6 });
    await page.waitForTimeout(60);

    await page.keyboard.press("Escape");
    await page.waitForTimeout(120);

    expect((await thePoints(board)).length, "the three placed points, not the preview").toBe(3);
  });

  /**
   * A drag is still a drag. The fork is decided on release, so this is the control for
   * every case above: if it broke, the click path would have swallowed the gesture that
   * has always drawn a line.
   */
  test("still draws one segment from a drag", async ({ page }) => {
    const board = await openBoard(page);
    await pickTool(page, "Line");

    const from = at(board, START.x, START.y);
    const to = at(board, START.x + 300, START.y + 180);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(120);

    expect((await thePoints(board)).length).toBe(2);
    expect(await activeTool(page), "a drag finishes on release").toBe("select");
  });
});

test.describe("a line and the shapes it crosses", () => {
  /**
   * "The line should not rely or be stick to other elements." Excalidraw agrees:
   * `isBindingElementType` is `arrow` and nothing else.
   */
  test("does not attach itself to a shape it is drawn across", async ({ page }) => {
    const board = await openBoard(page);
    await pickTool(page, "Rectangle");
    const boxFrom = at(board, START.x, START.y);
    const boxTo = at(board, START.x + 160, START.y + 120);
    await page.mouse.move(boxFrom.x, boxFrom.y);
    await page.mouse.down();
    await page.mouse.move(boxTo.x, boxTo.y, { steps: 6 });
    await page.mouse.up();

    await pickTool(page, "Line");
    const lineFrom = at(board, START.x + 80, START.y + 60);
    const lineTo = at(board, START.x + 420, START.y + 60);
    await page.mouse.move(lineFrom.x, lineFrom.y);
    await page.mouse.down();
    await page.mouse.move(lineTo.x, lineTo.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(120);

    const startX = (await theLine(board)).x;

    // Move the rectangle a long way. A bound line would follow it.
    await pickTool(page, "Select");
    const grab = at(board, START.x, START.y);
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x, grab.y + 260, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(150);

    expect((await theLine(board)).x, "the line should not have been dragged along").toBeCloseTo(
      startX,
      1,
    );
  });
});
