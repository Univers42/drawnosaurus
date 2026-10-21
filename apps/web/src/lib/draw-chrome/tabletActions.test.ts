import { describe, expect, it } from "vitest";
import type { ShapeActions } from "./shapeActions.ts";
import { tabletActionPlan } from "./tabletActions.ts";

/**
 * The tablet's compact style panel.
 *
 * Oracle: `CompactShapeActions` (`Actions.tsx@1118751f:612-724`) — "the collapsed,
 * popover-driven layout used on tablets": a narrow column of icon buttons, each opening
 * a popover, in place of the full inspector.
 *
 * The order is the oracle's, because the order is the panel: the colours first, then
 * the rows that travel together, then the selection's own actions.
 */
describe("tabletActionPlan", () => {
  const fullyCapable: ShapeActions = {
    visible: true,
    strokeColor: true,
    backgroundColor: true,
    fill: true,
    strokeWidth: true,
    strokeStyle: true,
    sloppiness: true,
    roundness: true,
    arrowType: true,
    arrowheads: true,
    polygon: true,
    text: true,
    textAlign: true,
    verticalAlign: true,
    wrap: true,
    figureKind: true,
    figureSides: true,
    figureRatio: true,
    opacity: true,
    layers: true,
    mirror: true,
    group: true,
    align: true,
    distribute: true,
  };

  const rectangle: ShapeActions = {
    ...fullyCapable,
    arrowheads: false,
    arrowType: false,
    polygon: false,
    text: false,
    textAlign: false,
    verticalAlign: false,
    wrap: false,
    figureKind: false,
    figureSides: false,
    figureRatio: false,
  };

  it("shows the controls a selection has, in the oracle's order", () => {
    expect(tabletActionPlan(fullyCapable, true)).toEqual([
      "stroke",
      "background",
      "shape properties",
      "arrow properties",
      "font family",
      "text properties",
      "duplicate",
      "delete",
      "actions",
    ]);
  });

  it("shows only what a plain rectangle needs", () => {
    expect(tabletActionPlan(rectangle, true)).toEqual([
      "stroke",
      "background",
      "shape properties",
      "duplicate",
      "delete",
      "actions",
    ]);
  });

  it("coalesces the shape rows into one popover, the oracle's CombinedShapeProperties", () => {
    // The oracle's popover holds the fill style, the stroke width, the stroke style, the
    // sloppiness, the roundness and the opacity (`Actions.tsx@1118751f:290-306`). With
    // none of them applying there is nothing to open, so the button is not there.
    const onlyColour: ShapeActions = {
      ...fullyCapable,
      fill: false,
      strokeWidth: false,
      strokeStyle: false,
      sloppiness: false,
      roundness: false,
      opacity: false,
    };
    const plan = tabletActionPlan(onlyColour, true);
    expect(plan).not.toContain("shape properties");
    expect(plan).toContain("stroke");
    expect(plan).toContain("background");
  });

  it("keeps the font family and the text properties apart, as the oracle does", () => {
    // `Actions.tsx@1118751f:686-699`: the family is its own button, and the size, the
    // alignment and the vertical alignment travel together in the second.
    const plan = tabletActionPlan(fullyCapable, true);
    expect(plan.indexOf("font family")).toBeLessThan(plan.indexOf("text properties"));
  });

  it("has the selection's own actions only for a selection", () => {
    // The oracle's duplicate and delete buttons hang off `predicates.showExtraActions`
    // (`Actions.tsx@1118751f:702-713`), which is a selection's own. With a drawing tool
    // in hand and nothing selected, the panel still shows the colours.
    const plan = tabletActionPlan(fullyCapable, false);
    expect(plan).not.toContain("duplicate");
    expect(plan).not.toContain("delete");
    expect(plan).not.toContain("actions");
    expect(plan).toContain("stroke");
    expect(plan).toContain("background");
  });

  it("has no figure row: the oracle's compact panel has none", () => {
    // The oracle's compact panel carries no figure row (`Actions.tsx@1118751f:635-722`),
    // and a row the oracle does not have is a row this panel does not invent.
    expect(tabletActionPlan(fullyCapable, true)).not.toContain("figure" as never);
  });
});
