import { expect, test } from "../fixtures.ts";
import {
  OPEN_CANVAS,
  connect,
  expectArrowBound,
  expectLabelBound,
  expectSceneMatches,
  exportPngAndSvg,
  maybeWriteTemplate,
  openBoard,
  placeFigureAt,
  placeShapeAt,
  reopenWith,
  sceneElements,
  waitForAutosave,
  type Board,
  type FigureElement,
} from "./helpers.ts";

/**
 * Story 5 — mind map: a central topic, six branches around it joined by arrows (curved
 * by default — `arrowType.spec.ts` — so nothing extra is needed to get the curve), and a
 * few stars and triangles (a polygon at 3 sides) scattered in different colours.
 */

const CENTER = { x: OPEN_CANVAS.left + 290, y: OPEN_CANVAS.top + 200, w: 140, h: 80 };
const BRANCHES = [
  { x: OPEN_CANVAS.left + 555, y: OPEN_CANVAS.top + 215, label: "Design" },
  { x: OPEN_CANVAS.left + 425, y: OPEN_CANVAS.top + 85, label: "Budget" },
  { x: OPEN_CANVAS.left + 165, y: OPEN_CANVAS.top + 85, label: "Timeline" },
  { x: OPEN_CANVAS.left + 35, y: OPEN_CANVAS.top + 215, label: "Team" },
  { x: OPEN_CANVAS.left + 165, y: OPEN_CANVAS.top + 345, label: "Risks" },
  { x: OPEN_CANVAS.left + 425, y: OPEN_CANVAS.top + 345, label: "Marketing" },
] as const;
// Wide enough that "Marketing" (9 chars) wraps on a word boundary rather than mid-word.
const BRANCH_SIZE = { w: 130, h: 50 };

/** Clicks a quick stroke swatch on the currently-selected element — the light theme's
 *  five (`inspector.ts::LIGHT_STROKE_SWATCHES`), which `fontSize.spec.ts` and
 *  `textEditor.spec.ts` already click the same way. */
async function paintSelectedStroke(board: Board, hex: string): Promise<void> {
  await board.page.getByRole("button", { name: hex, exact: true }).first().click();
}

/** The Sides stepper set to 3 — a triangle, the same way `pitch.spec.ts` makes a pentagon. */
async function makeTriangle(board: Board, figure: FigureElement): Promise<void> {
  const sides = board.page.getByRole("spinbutton", { name: "Sides" });
  await sides.fill("3");
  await sides.press("Enter");
  await expect
    .poll(
      async () =>
        (await sceneElements(board.page)).find((el): el is FigureElement => el.id === figure.id)
          ?.figure?.sides,
    )
    .toBe(3);
}

test("mind map: a central topic, six branches, and a scatter of coloured figures", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const slug = "mindmap";
  const board = await openBoard(page, slug);

  const center = await placeShapeAt(
    board,
    "Ellipse",
    { x: CENTER.x, y: CENTER.y },
    { w: CENTER.w, h: CENTER.h },
    "Idea",
  );

  const branches = [];
  const arrows = [];
  for (const branch of BRANCHES) {
    const node = await placeShapeAt(
      board,
      "Rectangle",
      { x: branch.x, y: branch.y },
      BRANCH_SIZE,
      branch.label,
    );
    branches.push(node);
    arrows.push(await connect(board, center, node));
  }

  const star1 = await placeFigureAt(
    board,
    "Star",
    { x: OPEN_CANVAS.left + 330, y: OPEN_CANVAS.top + 15 },
    { w: 60, h: 60 },
  );
  await paintSelectedStroke(board, "#e03131");

  const star2 = await placeFigureAt(
    board,
    "Star",
    { x: OPEN_CANVAS.left + 330, y: OPEN_CANVAS.top + 415 },
    { w: 60, h: 60 },
  );
  await paintSelectedStroke(board, "#2f9e44");

  const triangle1 = await placeFigureAt(
    board,
    "Polygon",
    { x: OPEN_CANVAS.left + 20, y: OPEN_CANVAS.top + 30 },
    { w: 70, h: 60 },
  );
  await makeTriangle(board, triangle1);
  await paintSelectedStroke(board, "#1971c2");

  const triangle2 = await placeFigureAt(
    board,
    "Polygon",
    { x: OPEN_CANVAS.left + 620, y: OPEN_CANVAS.top + 410 },
    { w: 70, h: 60 },
  );
  await makeTriangle(board, triangle2);
  await paintSelectedStroke(board, "#f08c00");

  const built = await sceneElements(page);
  const counts: Record<string, number> = {};
  for (const element of built) counts[element.type] = (counts[element.type] ?? 0) + 1;
  expect(counts["ellipse"]).toBe(1);
  expect(counts["rectangle"]).toBe(6);
  expect(counts["figure"]).toBe(4);
  expect(counts["arrow"]).toBe(6);
  expect(counts["text"]).toBe(7); // the topic + 6 branch labels

  for (const [index, arrow] of arrows.entries()) {
    expectArrowBound(arrow, center.id, branches[index]!.id);
  }
  expectLabelBound(built, center.id, "Idea");
  for (const [index, branch] of branches.entries()) {
    expectLabelBound(built, branch.id, BRANCHES[index]!.label);
  }

  // Curved by default: every branch arrow carries roundness, as `arrowType.spec.ts` pins.
  for (const arrow of arrows) {
    expect(arrow.roundness ?? null, "arrows are curved by default").not.toBeNull();
  }

  const byId = new Map(built.map((element) => [element.id, element as FigureElement]));
  expect(byId.get(star1.id)?.figure?.kind).toBe("star");
  expect(byId.get(star2.id)?.figure?.kind).toBe("star");
  expect(byId.get(triangle1.id)?.figure).toEqual({ kind: "polygon", sides: 3 });
  expect(byId.get(triangle2.id)?.figure).toEqual({ kind: "polygon", sides: 3 });

  const colors = [star1, star2, triangle1, triangle2].map((el) => byId.get(el.id)?.strokeColor);
  expect(colors).toEqual(["#e03131", "#2f9e44", "#1971c2", "#f08c00"]);
  expect(new Set(colors).size, "four different colours").toBe(4);

  await maybeWriteTemplate(board, "mindmap");

  const saved = await waitForAutosave(board);
  expectSceneMatches(built, saved.values(), "the saved scene matches what was drawn");
  const reopened = await reopenWith(board, slug, saved);
  expectSceneMatches(
    await sceneElements(reopened.page),
    saved.values(),
    "the reload matches the save",
  );

  await exportPngAndSvg(board);
});
