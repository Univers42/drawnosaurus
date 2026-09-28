import { expect, test } from "./fixtures.ts";
import { OPEN_CANVAS, openBoard, pickTool, sceneElements, type Board } from "./board.ts";
import { writeText, type BoardElement } from "./textBoard.ts";

/**
 * Dragging an arrow's label along the arrow, the gesture `ci_label_position.rs` drives
 * through the engine's own pointer API. What this spec adds is the half an engine test
 * cannot reach: that the host forwards the press, the move and the release, and reads the
 * position back out of the scene JSON it sends over.
 *
 * The gesture is a primary press on the label and a drag, and the press has to land clear
 * of the line editor's own midpoint knob — at the default the label sits on it, and the
 * knob wins by design, "so a labeled arrow can still be bent at its middle"
 * (`App.tsx@1118751f:1149-1151`). So every drag here starts 20 units to the side of the
 * label's centre, on a label wide enough for that to be well inside it.
 */

const Y = OPEN_CANVAS.top + 200;
const X0 = OPEN_CANVAS.left + 40;
/** Half the "hello" label at size 20, so 20 is inside the box and clear of the knob. */
const GRAB_FROM_CENTRE = 20;

async function drag(board: Board, from: { x: number; y: number }, to: { x: number; y: number }) {
  const { page } = board;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

/** A straight 300-long arrow from `(X0, Y)`, with a "hello" label bound to it. */
async function labelled(board: Board): Promise<{ arrow: BoardElement; text: BoardElement }> {
  await pickTool(board.page, "Arrow");
  await drag(
    board,
    { x: board.box.x + X0, y: board.box.y + Y },
    { x: board.box.x + X0 + 300, y: board.box.y + Y },
  );
  const arrow = (await sceneElements(board.page)).find((el) => el.type === "arrow");
  if (!arrow) throw new Error("no arrow was drawn");
  const text = await writeText(board, { x: X0 + 40, y: Y }, "hello");
  expect(text.containerId, "bound to the arrow").toBe(arrow.id);
  return { arrow: arrow as BoardElement, text };
}

const centreOf = (text: BoardElement) => ({
  x: text.x + text.width / 2,
  y: text.y + text.height / 2,
});

const rowOf = async (board: Board, id: string) => {
  const row = (await sceneElements(board.page)).find((el) => el.id === id);
  if (!row) throw new Error(`${id} is not in the scene`);
  return row as BoardElement;
};

/**
 * The Q/R pair, on the same scene: a label dragged to a stated place must land on the
 * exact world point, and the same scene with no drag must land on the middle. Both halves
 * in one test so they cannot drift apart, and both read the scene the host was sent.
 */
test("dragging the label puts it on the path, and no drag leaves it in the middle", async ({
  page,
}) => {
  // **Q.** A 300-long straight arrow. Its label is grabbed 20 to the right of its own
  // centre — so the anchor starts at X0 + 170 — and carried to a pointer at X0 + 95,
  // which puts the anchor 75 along: a quarter of 300, and therefore X0 + 75.
  const dragged = await openBoard(page);
  const { arrow, text } = await labelled(dragged);
  expect(centreOf(text).x, "setup: the middle").toBeCloseTo(X0 + 150, 0);
  // Read the arrow *after* the label was bound to it: binding writes `boundTextId` and
  // that is a version of its own, so a row captured before it would make the drag look
  // like it restamped the arrow when it did not.
  const arrowBefore = await rowOf(dragged, arrow.id);

  await drag(
    dragged,
    { x: dragged.box.x + X0 + 150 + GRAB_FROM_CENTRE, y: dragged.box.y + Y },
    { x: dragged.box.x + X0 + 95, y: dragged.box.y + Y },
  );

  const moved = await rowOf(dragged, text.id);
  expect(moved.labelPosition, "a quarter along the path").toBeCloseTo(0.25, 2);
  expect(centreOf(moved).x, "the exact world point").toBeCloseTo(X0 + 75, 0);
  expect(centreOf(moved).y).toBeCloseTo(Y, 0);

  // The arrow is untouched: the same points, the same box, and not even a new version. A
  // test that only watched the label would pass for an implementation that dragged the
  // whole arrow.
  const arrowAfter = await rowOf(dragged, arrow.id);
  expect(arrowAfter.points, "the arrow's points did not move").toEqual(arrowBefore.points);
  expect(arrowAfter.x).toBeCloseTo(arrowBefore.x, 5);
  expect(arrowAfter.width).toBeCloseTo(arrowBefore.width, 5);
  expect(arrowAfter.version, "the arrow was not restamped").toBe(arrowBefore.version);

  // **R.** The same scene, built again, and nothing dragged.
  const still = await openBoard(page);
  const untouched = await labelled(still);
  expect(untouched.text.labelPosition, "a label nobody moved has no position").toBeUndefined();
  expect(centreOf(untouched.text).x, "still the middle of the path").toBeCloseTo(X0 + 150, 0);
});

/**
 * The ends are legal and reachable: dragged off the far end the label lands on the arrow's
 * last point, and there is no dead zone short of it.
 */
test("dragging past an end parks the label on that end", async ({ page }) => {
  const board = await openBoard(page);
  const { text } = await labelled(board);

  await drag(
    board,
    { x: board.box.x + X0 + 150 + GRAB_FROM_CENTRE, y: board.box.y + Y },
    { x: board.box.x + X0 + 3000, y: board.box.y + Y },
  );
  const atEnd = await rowOf(board, text.id);
  expect(atEnd.labelPosition).toBeCloseTo(1, 2);
  expect(centreOf(atEnd).x, "the arrow's last point").toBeCloseTo(X0 + 300, 0);
});

/** What it looks like: the label dragged off the middle of a curved arrow. */
test("a label on a curved arrow rides its curve", async ({ page }, testInfo) => {
  const board = await openBoard(page);
  await pickTool(page, "Arrow");
  // Three points, placed with a gap between clicks: two clicks on one spot with nothing
  // between them read as a double click and would finish the path early.
  for (const [x, y] of [
    [X0, Y],
    [X0 + 150, Y - 140],
    [X0 + 300, Y],
  ] as [number, number][]) {
    await page.mouse.move(board.box.x + x, board.box.y + y, { steps: 6 });
    await page.mouse.click(board.box.x + x, board.box.y + y);
    await page.waitForTimeout(60);
  }
  await page.mouse.click(board.box.x + X0 + 300, board.box.y + Y);
  await page.waitForTimeout(120);
  const arrow = (await sceneElements(page)).find((el) => el.type === "arrow");
  expect(arrow?.points, "setup: three waypoints").toHaveLength(3);
  const text = await writeText(board, { x: X0 + 40, y: Y - 34 }, "hello");

  // Drag the label left along the first half of the path. On a curve the press has to be
  // off the vertical too, or it lands outside the label's box.
  await drag(
    board,
    { x: board.box.x + X0 + 150, y: board.box.y + Y - 140 + 18 },
    { x: board.box.x + X0 + 60, y: board.box.y + Y - 20 },
  );

  const moved = await rowOf(board, text.id);
  expect(moved.labelPosition, "dragged off the middle").toBeLessThan(0.5);
  // The point that matters: above the chord between the two ends. A label placed on the
  // polyline rather than the drawn curve would sit visibly lower.
  expect(centreOf(moved).y, "on the curve, not the chord").toBeLessThan(Y - 40);

  await page.screenshot({ path: testInfo.outputPath("label-on-a-curve.png") });
});
