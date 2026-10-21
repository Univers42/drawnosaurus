import { describe, expect, it } from "vitest";
import { FOLDED_CHIPS, TITLE_MAX, TITLE_MIN, topBarPlan, type TopBarWidths } from "./topBar.ts";

/**
 * The top bar's plan.
 *
 * The tool bar sits in the middle of the header's row, and the header's two ends share
 * what is left of it. The oracle's top bar has no title and no status chips, so how
 * those give way is ours to decide: the title first — cut short with an ellipsis — and
 * the chips next, folded into one icon whose label is the full text.
 *
 * The widths below are the ones the browser measures on this chrome: a 497px tool bar
 * (twelve 36px buttons, two rules and the gaps), a 40px menu button, a 12px title frame,
 * a 112px "Unsaved changes" chip, a 131px Share-and-Help end, an 8px gap and a 14px
 * margin.
 */
describe("topBarPlan", () => {
  const measured: TopBarWidths = {
    toolbar: 497,
    leftFixed: 60,
    title: 52,
    chips: 112,
    right: 131,
    gap: 8,
    margin: 14,
    viewport: 1280,
  };

  it("leaves the desktop alone: one row, the title whole, the chips open", () => {
    const plan = topBarPlan(measured);
    expect(plan.toolbarOwnRow).toBe(false);
    expect(plan.foldChips).toBe(false);
    expect(plan.titleMaxWidth).toBe(TITLE_MAX);
  });

  it("cuts the title short before it folds the chips", () => {
    // 1024: the tool bar is still in the row and the title has less room than it wants.
    // The side of the row is (1024 - 497) / 2 - 14 = 249.5, and the title gets what is
    // left of it: 249.5 - 60 (the menu, the gap and the title's frame) - 120 (the chip
    // and its gap) = 69.5.
    const plan = topBarPlan({ ...measured, viewport: 1024 });
    expect(plan.toolbarOwnRow).toBe(false);
    expect(plan.foldChips).toBe(false);
    expect(plan.titleMaxWidth).toBe(70);
  });

  it("folds the chips into one icon when the title cannot keep a readable width", () => {
    // 900: the side of the row is 187.5. With the chips open the title would have 7.5px
    // of it, so the chips fold into one 28px icon and the title takes 187.5 - 60 - 36.
    const plan = topBarPlan({ ...measured, viewport: 900 });
    expect(plan.toolbarOwnRow).toBe(false);
    expect(plan.foldChips).toBe(true);
    expect(plan.titleMaxWidth).toBeGreaterThanOrEqual(TITLE_MIN);
    expect(plan.titleMaxWidth).toBe(92);
  });

  it("gives the tool bar a row of its own when the row cannot hold it", () => {
    // 768: the tool bar is 497px wide and centred, so each end of the row has 121px —
    // less than the menu, a title and a chip. The tool bar moves down and the header's
    // row is the width of the screen again: 768 - 28 - 131 - 8 = 601 for the left end.
    const plan = topBarPlan({ ...measured, viewport: 768 });
    expect(plan.toolbarOwnRow).toBe(true);
    expect(plan.foldChips).toBe(false);
    expect(plan.titleMaxWidth).toBe(TITLE_MAX);
  });

  it("does the same at the narrowest tablet", () => {
    const plan = topBarPlan({ ...measured, viewport: 600 });
    expect(plan.toolbarOwnRow).toBe(true);
    expect(plan.titleMaxWidth).toBe(TITLE_MAX);
  });

  it("never lets the title take more than its own width", () => {
    for (const viewport of [600, 768, 820, 900, 1024, 1180, 1280, 1920]) {
      expect(topBarPlan({ ...measured, viewport }).titleMaxWidth).toBeLessThanOrEqual(TITLE_MAX);
    }
  });

  it("keeps the folded chip the width of an icon", () => {
    // The folded chip is one icon, not one chip per status: the width the plan gives up
    // is the icon's, whatever the statuses say.
    const plan = topBarPlan({ ...measured, viewport: 900, chips: 240 });
    expect(plan.foldChips).toBe(true);
    expect(FOLDED_CHIPS).toBeLessThan(240);
  });

  it("keeps a title that fits alone", () => {
    // With no status chip at all there is nothing to fold, and the title takes the room:
    // 187.5 - 60 = 127.5.
    const plan = topBarPlan({ ...measured, viewport: 900, chips: 0 });
    expect(plan.foldChips).toBe(false);
    expect(plan.titleMaxWidth).toBe(128);
  });

  it("does not fold the chips for a title that fits whole", () => {
    // A title of four letters is four letters, not a stub: the chips keep their width
    // while there is room for both. At 940 the side of the row is 207.5, and the menu,
    // the gap, the title's frame, the title and the chip with its gap are 60 + 24 + 120
    // = 204 — which fits.
    const plan = topBarPlan({ ...measured, viewport: 940, title: 24 });
    expect(plan.foldChips).toBe(false);
    expect(plan.titleMaxWidth).toBe(28);
  });
});
