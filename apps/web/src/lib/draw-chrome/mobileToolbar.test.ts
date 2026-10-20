import { describe, expect, it } from "vitest";
import { EXTRA_TOOLS } from "./tools.ts";
import { mobileToolbarPlan } from "./mobileToolbar.ts";

/**
 * The bottom bar's plan, at a measured width.
 *
 * Menu widths are the one behaviour the oracle leaves to JavaScript rather than CSS
 * (`MobileToolbar.tsx@1118751f:102-114`): a row of buttons is decided in pixels —
 * `WIDTH=36`, `GAP=4`, `MIN_TOOLS=7` — so text, image and frame join the bar only when
 * they fit, and fall back behind More when they do not. A CSS media query cannot know
 * the row's own content, which is why this module exists and why layout beside it stays
 * in CSS.
 */
describe("mobileToolbarPlan", () => {
  // The oracle's arithmetic, in constants here because the test proves the numbers:
  // MIN_WIDTH = 7 × 36 + 6 × 4 = 276, one more slot = 36 + 4 = 40 more.
  const MIN_WIDTH = 7 * 36 + 6 * 4;

  it("keeps the seven-slot base at the smallest usable width", () => {
    const plan = mobileToolbarPlan(MIN_WIDTH);
    expect(plan.shown).toEqual(["hand", "select", "freedraw", "eraser", "shapes", "lines", "more"]);
    expect(plan.promoted).toEqual([]);
  });

  it("leaves the window's bare base below the oracle's minimum", () => {
    // Nothing is promoted on a row narrower than the base; nothing overflows the bar.
    expect(mobileToolbarPlan(MIN_WIDTH - 40).promoted).toEqual([]);
  });

  it("promotes text, then image, then frame as width allows", () => {
    expect(mobileToolbarPlan(MIN_WIDTH + 40).promoted).toEqual(["text"]);
    expect(mobileToolbarPlan(MIN_WIDTH + 80).promoted).toEqual(["text", "image"]);
    expect(mobileToolbarPlan(MIN_WIDTH + 120).promoted).toEqual(["text", "image", "frame"]);
    // A width a notch short of a slot does not pay for one.
    expect(mobileToolbarPlan(MIN_WIDTH + 119).promoted).toEqual(["text", "image"]);
  });

  it("keeps the promoted tools in order on the bar", () => {
    const plan = mobileToolbarPlan(844 - 24);
    expect(plan.shown).toEqual([
      "hand",
      "select",
      "freedraw",
      "eraser",
      "shapes",
      "lines",
      "text",
      "image",
      "frame",
      "more",
    ]);
  });

  it("puts exactly the tools outside the bar behind More, in our own extra order", () => {
    const everyExtra = EXTRA_TOOLS.map((entry) => entry.tool);
    const full = mobileToolbarPlan(MIN_WIDTH);

    expect(full.overflow).toEqual(["image", "frame", ...everyExtra.slice(2)]);

    // Once text, image and frame are promoted, they leave More.
    const wide = mobileToolbarPlan(MIN_WIDTH + 120);
    expect(wide.overflow).toEqual(everyExtra.slice(2));
  });

  it("wears the last-used shape and line on their triggers", () => {
    // `lastActiveGenericShape` / `lastActiveLinearElement`
    // (`MobileToolbar.tsx@1118751f:52-57`): the popover's button reads the memory, and
    // picking through another UI updates it.
    const plan = mobileToolbarPlan(MIN_WIDTH, { shape: "diamond", linear: "line" });
    expect(plan.wears.shapes).toBe("diamond");
    expect(plan.wears.lines).toBe("line");
    // First visit: rectangle and arrow, the oracle's own defaults.
    expect(
      mobileToolbarPlan(MIN_WIDTH).wears,
    ).toMatchObject({ shapes: "rectangle", lines: "arrow" });
  });

  it("still names More, promoted or not, with the active extra tool's own icon", () => {
    // `extraIcon` (`MobileToolbar.tsx@1118751f:135-154`): the trigger wears the active
    // extra tool's icon, so picking a tool from More leaves its face on the bar.
    const plan = mobileToolbarPlan(MIN_WIDTH, { active: "bucketfill" });
    expect(plan.wears.more).toBe("bucketfill");
    // A promoted tool is not an extra and leaves More wearing its dots.
    expect(mobileToolbarPlan(MIN_WIDTH + 120, { active: "text" }).wears.more).toBeNull();
    expect(mobileToolbarPlan(MIN_WIDTH, { active: "text" }).wears.more).toBeNull();
  });
});
