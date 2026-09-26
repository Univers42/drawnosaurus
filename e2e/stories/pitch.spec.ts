import { expect, test } from "../fixtures.ts";
import {
  OPEN_CANVAS,
  drawClosedLine,
  expectSceneMatches,
  exportPngAndSvg,
  focusBoard,
  maybeWriteTemplate,
  openBoard,
  placeFigureAt,
  placeFrame,
  placeShapeAt,
  reopenWith,
  sceneElements,
  waitForAutosave,
  writeText,
  type FigureElement,
} from "./helpers.ts";

/**
 * Story 4 — pitch deck: four frames as slides (Problem, Solution, Market, Ask), each
 * titled and carrying a couple of short content lines plus a shape where one fits —
 * an ellipse, a star, a pentagon, and the ask itself as a closed polygon; then a real
 * run through Present mode (`presentation.spec.ts`'s own keys) over all four, and out
 * again.
 */

const SLIDE_W = 330;
const SLIDE_H = 190;
const LEFT = OPEN_CANVAS.left + 10;
const RIGHT = LEFT + SLIDE_W + 20;
const TOP = OPEN_CANVAS.top + 20;
const BOTTOM = TOP + SLIDE_H + 20;

const SLIDES = [
  { x: LEFT, y: TOP, title: "Problem", content: "Slow onboarding\nManual support" },
  { x: RIGHT, y: TOP, title: "Solution", content: "One click checkout\nAuto receipts" },
  { x: LEFT, y: BOTTOM, title: "Market", content: "2M target users\n20% MoM growth" },
  { x: RIGHT, y: BOTTOM, title: "Ask", content: "$500k seed\n18mo runway" },
] as const;

/** The right-hand column every slide but Ask puts its one shape in, clear of the title
 *  above and the content column to its left. */
const SHAPE_ZONE = { dx: 215, dy: 58, w: 90, h: 90 };

test("pitch deck: four titled slides, three figures, and a run through Present", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const slug = "pitch";
  const board = await openBoard(page, slug);

  const frames = [];
  const titles = [];
  const contents = [];
  for (const slide of SLIDES) {
    frames.push(await placeFrame(board, { x: slide.x, y: slide.y }, { w: SLIDE_W, h: SLIDE_H }));
    titles.push(await writeText(board, { x: slide.x + 20, y: slide.y + 20 }, slide.title));
    contents.push(await writeText(board, { x: slide.x + 20, y: slide.y + 58 }, slide.content));
  }

  const problemShape = await placeShapeAt(
    board,
    "Ellipse",
    { x: SLIDES[0]!.x + SHAPE_ZONE.dx, y: SLIDES[0]!.y + SHAPE_ZONE.dy },
    { w: SHAPE_ZONE.w, h: SHAPE_ZONE.h },
  );

  const star = await placeFigureAt(
    board,
    "Star",
    { x: SLIDES[1]!.x + SHAPE_ZONE.dx, y: SLIDES[1]!.y + SHAPE_ZONE.dy },
    { w: SHAPE_ZONE.w, h: SHAPE_ZONE.h },
  );

  const polygon = await placeFigureAt(
    board,
    "Polygon",
    { x: SLIDES[2]!.x + SHAPE_ZONE.dx, y: SLIDES[2]!.y + SHAPE_ZONE.dy },
    { w: SHAPE_ZONE.w, h: SHAPE_ZONE.h },
  );
  // A pentagon, not the default hexagon — distinctly "a polygon" of its own.
  await page.getByRole("spinbutton", { name: "Sides" }).fill("5");
  await page.getByRole("spinbutton", { name: "Sides" }).press("Enter");
  await expect
    .poll(
      async () =>
        (await sceneElements(page)).find((el): el is FigureElement => el.id === polygon.id)?.figure
          ?.sides,
    )
    .toBe(5);

  // Sharp, not the default curved edges — a curved closed path came out as a lens, not
  // a shape anyone would read as a polygon. Set before drawing, the same way the arrow
  // rows pick a type for the *next* one (`arrowType.spec.ts`).
  const p4 = SLIDES[3]!;
  const closedLine = await drawClosedLine(
    board,
    [
      { x: p4.x + 180, y: p4.y + 130 },
      { x: p4.x + 245, y: p4.y + 60 },
      { x: p4.x + 310, y: p4.y + 130 },
      { x: p4.x + 245, y: p4.y + 170 },
    ],
    { sharp: true },
  );
  expect(closedLine.roundness ?? null, "sharp, so it reads as a polygon, not a lens").toBeNull();

  const built = await sceneElements(page);
  const counts: Record<string, number> = {};
  for (const element of built) counts[element.type] = (counts[element.type] ?? 0) + 1;
  expect(counts["frame"]).toBe(4);
  expect(counts["ellipse"]).toBe(1);
  expect(counts["figure"]).toBe(2);
  expect(counts["line"]).toBe(1);
  expect(counts["text"]).toBe(8); // 4 titles + 4 content blocks

  const byId = new Map(built.map((element) => [element.id, element]));
  for (const [index, frame] of frames.entries()) {
    expect(byId.get(titles[index]!.id)?.frameId, `${SLIDES[index]!.title} title in its frame`).toBe(
      frame.id,
    );
    expect(
      byId.get(contents[index]!.id)?.frameId,
      `${SLIDES[index]!.title} content in its frame`,
    ).toBe(frame.id);
  }
  expect(byId.get(problemShape.id)?.frameId, "the ellipse is on the Problem slide").toBe(
    frames[0]!.id,
  );
  expect(byId.get(star.id)?.frameId, "the star is on the Solution slide").toBe(frames[1]!.id);
  expect(byId.get(polygon.id)?.frameId, "the polygon is on the Market slide").toBe(frames[2]!.id);
  expect(byId.get(closedLine.id)?.frameId, "the closed line is on the Ask slide").toBe(
    frames[3]!.id,
  );

  const line = byId.get(closedLine.id)!;
  expect(line.polygon, "closing the path on itself makes it a polygon").toBe(true);
  const points = line.points ?? [];
  expect(points, "five points: four drawn, one closing the loop").toHaveLength(5);
  const [first, last] = [points[0]!, points[points.length - 1]!];
  expect(
    Math.hypot(first[0] - last[0], first[1] - last[1]),
    "the loop is shut exactly",
  ).toBeCloseTo(0, 6);

  await maybeWriteTemplate(board, "pitch");

  // Present, step through all four, and exit.
  await focusBoard(board);
  await page.keyboard.press("Control+Alt+p");
  await expect(page.getByText("1 / 4")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("2 / 4")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("3 / 4")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("4 / 4")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("group", { name: "Presentation controls" })).toBeHidden();

  // Save → reload.
  const saved = await waitForAutosave(board);
  expectSceneMatches(built, saved.values(), "the saved scene matches what was drawn");
  const reopened = await reopenWith(board, slug, saved);
  expectSceneMatches(
    await sceneElements(reopened.page),
    saved.values(),
    "the reload matches the save",
  );

  // Export.
  await exportPngAndSvg(board);
});
