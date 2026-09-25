import { expect, test } from "./fixtures.ts";
import { OPEN_CANVAS, openBoard, pickTool, regionInk, sceneElements, type Board } from "./board.ts";
import { writeText, type BoardElement } from "./textBoard.ts";

/**
 * Double-clicking an arrow's own line, like Excalidraw: the label centres on the arrow's
 * middle (its curve, if it has one), wraps at the arrow's width, is cut clear of the
 * stroke, and — since dragging a point *is* an arrow's resize, it has no handle of its
 * own — re-wraps and re-centres whenever the arrow's length changes
 * (`ci_text_model.rs`, `docs/reference/text-model.md` › Layout).
 */

const Y = OPEN_CANVAS.top + 200;
const X0 = OPEN_CANVAS.left + 40;

async function drag(board: Board, from: { x: number; y: number }, to: { x: number; y: number }) {
  const { page } = board;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

/** A straight two-point arrow, drawn by dragging: from `(X0, Y)` to `(X0 + length, Y)`. */
async function straightArrow(board: Board, length: number): Promise<BoardElement> {
  const { page, box } = board;
  await pickTool(page, "Arrow");
  await drag(board, { x: box.x + X0, y: box.y + Y }, { x: box.x + X0 + length, y: box.y + Y });
  const arrow = (await sceneElements(page)).find((el) => el.type === "arrow");
  if (!arrow) throw new Error("no arrow was drawn");
  return arrow as BoardElement;
}

/**
 * A three-point arrow, click by click — a drag only ever finishes as one straight
 * segment (`ci_line_multipoint.rs`) — round by the default roundness, so it is drawn as
 * a curve rather than sharp corners. Moved to in steps and settled with a wait between
 * clicks, as `lineMultipoint.spec.ts` does: two clicks on the same spot with nothing
 * between them is what a browser reads as its own double click, which would finish the
 * path early instead of placing the point just placed a second time.
 */
async function place(board: Board, x: number, y: number): Promise<void> {
  const { page, box } = board;
  await page.mouse.move(box.x + x, box.y + y, { steps: 6 });
  await page.mouse.click(box.x + x, box.y + y);
  await page.waitForTimeout(60);
}

async function curvedArrow(board: Board): Promise<BoardElement> {
  const { page } = board;
  await pickTool(page, "Arrow");
  await place(board, X0, Y);
  await place(board, X0 + 150, Y - 120);
  await place(board, X0 + 300, Y);
  // Clicking the point just placed finishes the path there, dropping the preview point.
  await place(board, X0 + 300, Y);
  await page.waitForTimeout(120);
  const arrow = (await sceneElements(page)).find((el) => el.type === "arrow");
  if (!arrow) throw new Error("no arrow was drawn");
  expect(arrow.points, "setup: three waypoints").toHaveLength(3);
  return arrow as BoardElement;
}

async function label(board: Board): Promise<BoardElement | undefined> {
  return (await sceneElements(board.page)).find((el) => el.type === "text") as
    BoardElement | undefined;
}

test("a double click on a straight arrow's line opens its label, centred on the middle", async ({
  page,
}) => {
  const board = await openBoard(page);
  const arrow = await straightArrow(board, 300);
  // Well off centre (X0 + 150) and off both ends, but on the line.
  const text = await writeText(board, { x: X0 + 40, y: Y }, "hi");
  expect(text.containerId, "bound to the arrow, not a free text").toBe(arrow.id);
  expect(text.x + text.width / 2, "centred on the arrow's midpoint").toBeCloseTo(X0 + 150, 0);
  expect(text.y + text.height / 2).toBeCloseTo(Y, 0);
  expect(text.angle ?? 0, "an arrow's label never turns").toBe(0);
});

test("a double click on a curved arrow's line opens its label on the curve, not the chord", async ({
  page,
}) => {
  const board = await openBoard(page);
  const arrow = await curvedArrow(board);
  // On the first segment, well off both its own chord midpoint and the whole path's
  // vertex at index 1.
  const text = await writeText(board, { x: X0 + 40, y: Y - 32 }, "hi");
  expect(text.containerId).toBe(arrow.id);
  // The label sits on the path's own middle vertex (three points: index 1), not at the
  // click, not at either end, and clearly above the flat chord between the two ends —
  // the "totally offset" symptom this guards against would leave it near y = Y instead.
  expect(text.x + text.width / 2).toBeCloseTo(X0 + 150, 1);
  expect(text.y + text.height / 2, "on the peak, not the flat chord").toBeLessThan(Y - 60);
});

test("a long label wraps within the arrow's width, on a straight and a curved arrow", async ({
  page,
}) => {
  const board = await openBoard(page);
  const straight = await straightArrow(board, 300);
  const long = await writeText(
    board,
    { x: X0 + 40, y: Y },
    "the quick brown fox jumps over the lazy dog and then some more besides",
  );
  expect(long.containerId).toBe(straight.id);
  const maxWidth = Math.max(0.7 * straight.width, 11 * (long.fontSize ?? 20));
  expect(long.width, `wrapped within 0.7 * ${straight.width}`).toBeLessThanOrEqual(maxWidth + 2);
  expect((long.text ?? "").includes("\n"), "more than one line").toBe(true);
});

test("dragging an end re-wraps and re-centres the label", async ({ page }) => {
  const board = await openBoard(page);
  const arrow = await straightArrow(board, 600);
  const before = await writeText(board, { x: X0 + 500, y: Y }, "the quick brown fox jumps over");
  expect((before.text ?? "").includes("\n"), "setup: fits one line at 600 long").toBe(false);

  // A plain click on the shaft selects the arrow (committing the label already left it
  // selected, but this does not depend on that): clear of the label and of the endpoint
  // handle a drag from there would otherwise start bending instead of grabbing.
  await board.page.mouse.click(board.box.x + X0 + 20, board.box.y + Y);
  const arrowRow = (await sceneElements(page)).find((el) => el.id === arrow.id)!;
  // Drag the far end from 600 back to 150: well under the label's unwrapped width.
  await drag(
    board,
    { x: board.box.x + X0 + arrowRow.width, y: board.box.y + Y },
    { x: board.box.x + X0 + 150, y: board.box.y + Y },
  );

  await expect
    .poll(async () => (await label(board))?.text ?? "")
    .toEqual(expect.stringContaining("\n"));
  const after = (await label(board))!;
  expect(after.x + after.width / 2, "re-centred on the shorter arrow").toBeCloseTo(X0 + 75, 0);
  const maxWidth = Math.max(0.7 * 150, 11 * (after.fontSize ?? 20));
  expect(after.width).toBeLessThanOrEqual(maxWidth + 2);
});

test("the arrow's stroke leaves no ink under the label", async ({ page }) => {
  const board = await openBoard(page);
  await straightArrow(board, 300);
  const text = await writeText(board, { x: X0 + 40, y: Y }, "hi");
  // Just inside the cut hole (label box plus 5px padding) but outside the glyphs
  // themselves, still on the stroke's own horizontal line: ink here means the hole
  // missed, or the label moved without it.
  const holeLeft = {
    left: board.box.x + text.x - 4,
    top: board.box.y + Y - 3,
    right: board.box.x + text.x - 1,
    bottom: board.box.y + Y + 3,
  };
  // The same band, a little further left, still on the line but outside the cut hole —
  // the stroke itself, as a control that ink is being measured at all.
  const onStroke = {
    left: board.box.x + text.x - 14,
    top: board.box.y + Y - 3,
    right: board.box.x + text.x - 11,
    bottom: board.box.y + Y + 3,
  };
  expect(await regionInk(page, onStroke), "control: the bare stroke has ink").toBeGreaterThan(0);
  expect(await regionInk(page, holeLeft), "no stroke ink under the label").toBe(0);
});
