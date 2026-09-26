import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { OPEN_CANVAS, openBoard, pickTool, regionInk, sceneElements, type Board } from "./board.ts";
import type { BoardElement } from "./textBoard.ts";

/**
 * The oracle's fuller arrowhead set (`getArrowheadOptions`,
 * `actionProperties.tsx@1118751f:1830-1942`): the plain heads it hides by default
 * (triangle_outline, circle_outline, diamond_outline — circle and diamond were already
 * covered as "dot"/"diamond" before this change) and the six cardinality/crow's-foot
 * markers ER diagrams use. Geometry is `ci_arrowhead_oracle.rs`'s job; this checks the
 * two things that test cannot: the picker in `menu.ts` actually reaches every kind
 * through the panel, and a picked head puts visible ink at the arrow's end, not just a
 * field on the element.
 */

const panel = (page: Page) => page.getByRole("complementary", { name: "Style inspector" });

const NEW_HEADS = [
  "Triangle (outline)",
  "Circle (outline)",
  "Diamond (outline)",
  "Cardinality (one)",
  "Cardinality (many)",
  "Cardinality (one or many)",
  "Cardinality (exactly one)",
  "Cardinality (zero or one)",
  "Cardinality (zero or many)",
] as const;

const FIELD: Record<(typeof NEW_HEADS)[number], string> = {
  "Triangle (outline)": "triangle_outline",
  "Circle (outline)": "circle_outline",
  "Diamond (outline)": "diamond_outline",
  "Cardinality (one)": "cardinality_one",
  "Cardinality (many)": "cardinality_many",
  "Cardinality (one or many)": "cardinality_one_or_many",
  "Cardinality (exactly one)": "cardinality_exactly_one",
  "Cardinality (zero or one)": "cardinality_zero_or_one",
  "Cardinality (zero or many)": "cardinality_zero_or_many",
};

/** Canvas-relative. A fresh horizontal row per call, so heads never overlap. */
function rowY(row: number): number {
  return OPEN_CANVAS.top + 50 + row * 60;
}

async function drawArrowEndingAt(
  board: Board,
  row: number,
): Promise<{ element: BoardElement; tipX: number; tipY: number }> {
  const { page, box } = board;
  const before = (await sceneElements(page)).length;
  const y = rowY(row);
  const tipX = OPEN_CANVAS.left + 260;
  await page.mouse.move(box.x + OPEN_CANVAS.left + 80, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + tipX, box.y + y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await sceneElements(page)).length).toBe(before + 1);
  const element = (await sceneElements(page)).at(-1) as BoardElement;
  return { element, tipX, tipY: y };
}

/**
 * A box around the tip generous enough for any head's own reach (the cardinality ticks
 * sit up to `CARDINALITY_MARKER_SIZE` behind it, `bounds.ts@1118751f:710`) — including the
 * shaft's own last few pixels, which a bare line puts there too. That is why every check
 * below is a comparison against a `none` reading of the very same box, not an absolute
 * threshold: what a head adds over a bare line, not "is there any ink at all".
 */
function tipBox(tipX: number, tipY: number) {
  return { left: tipX - 30, right: tipX + 6, top: tipY - 20, bottom: tipY + 20 };
}

test("every new head reaches the panel, lands on the element, and leaves ink at the tip", async ({
  page,
}) => {
  const board = await openBoard(page);
  await pickTool(page, "Arrow");

  await panel(page).getByRole("radio", { name: "End None" }).click();
  const bare = await drawArrowEndingAt(board, 0);
  expect(bare.element.endArrowhead ?? "none").toBe("none");
  const baseline = await regionInk(page, tipBox(bare.tipX, bare.tipY));

  for (const [index, label] of NEW_HEADS.entries()) {
    const row = index + 1;
    await panel(page)
      .getByRole("radio", { name: `End ${label}` })
      .click();
    await expect(panel(page).getByRole("radio", { name: `End ${label}` })).toBeChecked();

    const { element, tipX, tipY } = await drawArrowEndingAt(board, row);
    expect(element.endArrowhead, label).toBe(FIELD[label]);

    const withHead = await regionInk(page, tipBox(tipX, tipY));
    expect(
      withHead,
      `${label} should leave more ink at the tip than a bare line (${withHead} vs baseline ${baseline})`,
    ).toBeGreaterThan(baseline + 0.02);
  }
});
