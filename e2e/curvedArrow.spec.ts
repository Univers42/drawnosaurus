import { expect, test } from "./fixtures.ts";
import { OPEN_CANVAS, openBoard, pickTool, sceneElements, selection, type Board } from "./board.ts";
import { writeText, type BoardElement } from "./textBoard.ts";

/**
 * A curved arrow is the curve it is drawn as, and its points stay in reach.
 *
 * Both used to be the points: a click was measured against the straight segments
 * between them, so the bow of a curved arrow did not select it; and once it had three
 * points they sat behind the line editor, which a double click on an arrow never opens —
 * it opens the label. The engine half is `ci_curved_linear.rs`.
 */

const Y = OPEN_CANVAS.top + 200;
const X0 = OPEN_CANVAS.left + 40;

async function place(board: Board, x: number, y: number): Promise<void> {
  const { page, box } = board;
  await page.mouse.move(box.x + x, box.y + y, { steps: 6 });
  await page.mouse.click(box.x + x, box.y + y);
  await page.waitForTimeout(60);
}

/** Three clicks and a peak, rounded by default — see `arrowLabel.spec.ts`. */
async function curvedArrow(board: Board): Promise<BoardElement> {
  await pickTool(board.page, "Arrow");
  await place(board, X0, Y);
  await place(board, X0 + 150, Y - 120);
  await place(board, X0 + 300, Y);
  await place(board, X0 + 300, Y);
  await board.page.waitForTimeout(120);
  const arrow = (await sceneElements(board.page)).find((el) => el.type === "arrow");
  if (!arrow) throw new Error("no arrow was drawn");
  expect(arrow.points, "setup: three waypoints").toHaveLength(3);
  expect(arrow.roundness, "setup: rounded").toBeTruthy();
  return arrow as BoardElement;
}

type P = [number, number];

/** Points along the drawn curve: the Catmull-Rom the painter draws, both ends doubled. */
function alongTheCurve(points: P[]): P[] {
  const ps = [points[0]!, ...points, points[points.length - 1]!];
  const out: P[] = [];
  for (let j = 1; j + 2 < ps.length; j++) {
    const [a, b, prev, next] = [ps[j]!, ps[j + 1]!, ps[j - 1]!, ps[j + 2]!];
    const c1: P = [a[0] + (b[0] - prev[0]) / 6, a[1] + (b[1] - prev[1]) / 6];
    const c2: P = [b[0] + (a[0] - next[0]) / 6, b[1] + (a[1] - next[1]) / 6];
    for (const t of [0.25, 0.5, 0.75]) {
      const u = 1 - t;
      const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t] as const;
      out.push([
        w[0] * a[0] + w[1] * c1[0] + w[2] * c2[0] + w[3] * b[0],
        w[0] * a[1] + w[1] * c1[1] + w[2] * c2[1] + w[3] * b[1],
      ]);
    }
  }
  return out;
}

async function clickAway(board: Board): Promise<void> {
  await board.page.mouse.click(
    board.box.x + OPEN_CANVAS.right - 20,
    board.box.y + OPEN_CANVAS.bottom - 20,
  );
  expect(await selection(board.page)).toEqual([]);
}

test("a click anywhere along a curved, labelled arrow selects it", async ({ page }) => {
  const board = await openBoard(page);
  const arrow = await curvedArrow(board);
  await writeText(board, { x: X0 + 40, y: Y - 32 }, "flow");

  const world = alongTheCurve(arrow.points!.map((p) => [arrow.x + p[0]!, arrow.y + p[1]!]));
  for (const [x, y] of world) {
    await clickAway(board);
    await page.mouse.click(board.box.x + x, board.box.y + y);
    expect(await selection(page), `the curve at (${x.toFixed(0)}, ${y.toFixed(0)})`).toEqual([
      arrow.id,
    ]);
  }
});

test("the peak of a selected, labelled arrow is dragged on its own", async ({ page }) => {
  const board = await openBoard(page);
  const arrow = await curvedArrow(board);
  const label = await writeText(board, { x: X0 + 40, y: Y - 32 }, "flow");

  await clickAway(board);
  await page.mouse.click(board.box.x + X0 + 2, board.box.y + Y);
  expect(await selection(page)).toEqual([arrow.id]);

  // The peak sits under the label; the point is taken over it, as upstream.
  const from = { x: board.box.x + X0 + 150, y: board.box.y + Y - 120 };
  await page.mouse.move(from.x, from.y, { steps: 4 });
  await page.mouse.down();
  await page.mouse.move(from.x + 30, from.y - 40, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(120);

  const after = (await sceneElements(page)).find((el) => el.id === arrow.id)!;
  const world = after.points!.map((p) => [after.x + p[0]!, after.y + p[1]!]);
  expect(world[0], "the start stayed").toEqual([X0, Y]);
  expect(world[1], "the peak followed the pointer").toEqual([X0 + 180, Y - 160]);
  expect(world[2], "the end stayed").toEqual([X0 + 300, Y]);
  const moved = (await sceneElements(page)).find((el) => el.id === label.id)!;
  expect(moved.y, "and the label went with the peak").toBeLessThan(label.y);
});
