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
  reopenWith,
  sceneElements,
  waitForAutosave,
  writeText,
  type FigureElement,
} from "./helpers.ts";

/**
 * Story 4 — pitch deck: four frames as slides, each titled, carrying a star figure, a
 * polygon and a closed polygon line between them; then a real run through Present mode
 * (`presentation.spec.ts`'s own keys) over all four, and out again.
 */

const SLIDE_W = 330;
const SLIDE_H = 190;
const LEFT = OPEN_CANVAS.left + 10;
const RIGHT = LEFT + SLIDE_W + 20;
const TOP = OPEN_CANVAS.top + 20;
const BOTTOM = TOP + SLIDE_H + 20;

const SLIDES = [
  { x: LEFT, y: TOP, title: "Problem" },
  { x: RIGHT, y: TOP, title: "Solution" },
  { x: LEFT, y: BOTTOM, title: "Market" },
  { x: RIGHT, y: BOTTOM, title: "Ask" },
] as const;

test("pitch deck: four titled slides, three figures, and a run through Present", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const slug = "pitch";
  const board = await openBoard(page, slug);

  const frames = [];
  const titles = [];
  for (const slide of SLIDES) {
    frames.push(await placeFrame(board, { x: slide.x, y: slide.y }, { w: SLIDE_W, h: SLIDE_H }));
    titles.push(await writeText(board, { x: slide.x + 20, y: slide.y + 20 }, slide.title));
  }

  const star = await placeFigureAt(
    board,
    "Star",
    { x: SLIDES[1]!.x + 60, y: SLIDES[1]!.y + 70 },
    { w: 90, h: 90 },
  );

  const polygon = await placeFigureAt(
    board,
    "Polygon",
    { x: SLIDES[2]!.x + 60, y: SLIDES[2]!.y + 70 },
    { w: 90, h: 90 },
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

  const p4 = SLIDES[3]!;
  const closedLine = await drawClosedLine(board, [
    { x: p4.x + 60, y: p4.y + 130 },
    { x: p4.x + 150, y: p4.y + 60 },
    { x: p4.x + 240, y: p4.y + 130 },
    { x: p4.x + 150, y: p4.y + 170 },
  ]);

  const built = await sceneElements(page);
  const counts: Record<string, number> = {};
  for (const element of built) counts[element.type] = (counts[element.type] ?? 0) + 1;
  expect(counts["frame"]).toBe(4);
  expect(counts["figure"]).toBe(2);
  expect(counts["line"]).toBe(1);
  expect(counts["text"]).toBe(4);

  const byId = new Map(built.map((element) => [element.id, element]));
  for (const [index, frame] of frames.entries()) {
    expect(byId.get(titles[index]!.id)?.frameId, `${SLIDES[index]!.title} title in its frame`).toBe(
      frame.id,
    );
  }
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
