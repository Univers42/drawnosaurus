import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  OPEN_CANVAS,
  openBoard,
  pickTool,
  pixelColor,
  regionInk,
  sceneElements,
  type Board,
} from "./board.ts";
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
  // The model updates as soon as the gesture commits; the canvas repaint that
  // `regionInk` reads pixels from is a frame behind it (`cornerRadius.spec.ts`'s own
  // wait, for the same reason).
  await page.waitForTimeout(120);
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

  for (const [index, label] of NEW_HEADS.entries()) {
    // Drawing auto-selects the new shape and reverts to the Select tool, so picking the
    // tool again — with nothing selected — is what makes this "End None" set the *next*
    // arrow's default rather than mutate whatever the previous row left selected
    // (`ci_next_style.rs`'s own distinction between the two). It has to be redone every
    // row, not just once: `apply_style` (`selection_style.rs:825-828`) writes a selected
    // element's own style *and* the next-element default together, so the previous row's
    // click below already moved the default on to its own label — read once before this
    // fix, "bare" for row N silently started from row N-1's head, not from none.
    await pickTool(page, "Arrow");
    await panel(page).getByRole("radio", { name: "End None" }).click();
    const { tipX, tipY } = await drawArrowEndingAt(board, index);

    // This element's own bare-shaft ink, not a shared reading from a different arrow: a
    // rough.js seed is random per element, and comparing across two differently-seeded
    // sketches let a thin, low-ink head (`diamond_outline`, one cardinality tick) fall
    // within that seed noise rather than its own — an intermittent, non-timing failure
    // (observed down to a ~0.005 delta against a *shared* baseline). Measuring the same
    // element before and after the change below cancels that noise: only the head itself
    // can move this number.
    const bare = await regionInk(page, tipBox(tipX, tipY));

    // Still selected from the draw above, so this mutates the element in place.
    await panel(page)
      .getByRole("radio", { name: `End ${label}` })
      .click();
    await expect(panel(page).getByRole("radio", { name: `End ${label}` })).toBeChecked();
    await expect
      .poll(
        async () => ((await sceneElements(page)).at(-1) as BoardElement | undefined)?.endArrowhead,
      )
      .toBe(FIELD[label]);
    // The property change repaints a frame later, same as a draw.
    await page.waitForTimeout(120);

    const withHead = await regionInk(page, tipBox(tipX, tipY));
    expect(
      withHead,
      `${label} should leave more ink than the same arrow bare (${withHead} vs its own ${bare})`,
    ).toBeGreaterThan(bare + 0.01);
  }
});

/**
 * True if any pixel in the region (canvas-relative CSS pixels) is near-white.
 *
 * The regression this guards against: an outline head used to be filled with a fixed
 * `#ffffff` (`ARROWHEAD_OUTLINE_FILL`) regardless of the canvas it was painted on, so on
 * a dark board its punched-out hole read as a bright white blob instead of the theme's
 * own dark background. `regionInk`/`chromaInk` answer "is something there" or "is it
 * coloured", neither of which this needs — this asks about one specific colour.
 */
async function hasNearWhitePixel(
  page: Page,
  region: { left: number; top: number; right: number; bottom: number },
): Promise<boolean> {
  return page.evaluate((area) => {
    const canvas = document.querySelector("canvas");
    if (!canvas) throw new Error("no canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    const box = canvas.getBoundingClientRect();
    const scaleX = canvas.width / box.width;
    const scaleY = canvas.height / box.height;
    const x0 = Math.round(area.left * scaleX);
    const y0 = Math.round(area.top * scaleY);
    const w = Math.round((area.right - area.left) * scaleX);
    const h = Math.round((area.bottom - area.top) * scaleY);
    const { data } = ctx.getImageData(x0, y0, w, h);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i]! > 240 && data[i + 1]! > 240 && data[i + 2]! > 240) return true;
    }
    return false;
  }, region);
}

test("an outline head's fill follows the dark theme's background, not white", async ({ page }) => {
  const board = await openBoard(page);

  // The same switch a person uses (`DrawMainMenu.svelte`'s "Theme" radiogroup).
  await page.getByRole("button", { name: "Open main menu" }).click();
  await page
    .getByRole("radiogroup", { name: "Theme" })
    .getByRole("radio", { name: "Dark" })
    .click();
  await page.getByRole("button", { name: "Open main menu" }).click(); // toggles it closed

  await pickTool(page, "Arrow");
  await panel(page).getByRole("radio", { name: "End Circle (outline)" }).click();
  const { tipX, tipY } = await drawArrowEndingAt(board, 0);

  // Dark mode's own default ink is a near-white "#f8f9fa" (`DrawSurface.svelte`'s `ink`),
  // so it cannot stand in for "not white" here — a plain "no near-white pixel" check
  // would fail on the shaft and the head's own outline stroke regardless of the fix.
  // Forcing the stroke to black first isolates the one thing under test: the fill.
  // Still selected from the draw above; "s" needs a selection (`shortcuts.ts:125`).
  await page.keyboard.press("s");
  await page.keyboard.press("r"); // ELEMENT_PALETTE[3] = black, COLOR_HOTKEYS[3] = "r".
  await page.keyboard.press("Escape");
  await page.waitForTimeout(120);

  // Off any drawing, so it reads the theme's own background in either theme — the same
  // reference `regionInk` samples. Confirms the switch above actually took before the
  // real check below would otherwise pass vacuously on a canvas that stayed light.
  const background = await pixelColor(page, 4, 4);
  expect(
    background.every((c) => c < 100),
    `dark background read as rgb(${background})`,
  ).toBe(true);

  expect(await hasNearWhitePixel(page, tipBox(tipX, tipY))).toBe(false);
});
