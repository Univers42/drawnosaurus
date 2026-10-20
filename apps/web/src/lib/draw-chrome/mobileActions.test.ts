import { describe, expect, it } from "vitest";
import type { ShapeActions } from "./shapeActions.ts";
import { mobileActionBarPlan } from "./mobileActions.ts";

/**
 * The compact style strip, the phone's answer to the inspector.
 *
 * Oracle: `MobileShapeActions` (`Actions.tsx@1118751f:731-880`) — 32px buttons in a
 * six-pixel-gap row, `MIN_ACTIONS = 9` deciding when duplicate and delete step out of
 * the extra-actions popover into the right group beside undo and redo
 * (`:761-880` shows the right group; `showDeleteOutside` promotes first).
 */
describe("mobileActionBarPlan", () => {
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

  it("shows the properties the selection can act on, in the oracle's order", () => {
    const plan = mobileActionBarPlan(360, fullyCapable);
    expect(plan.left).toEqual([
      "stroke",
      "background",
      "shape properties",
      "arrow properties",
      "polygon",
      "text",
      "figure",
      "opacity",
      "layer actions",
    ]);
  });

  it("shows only what a plain rectangle needs", () => {
    const plan = mobileActionBarPlan(360, rectangle);
    expect(plan.left).toEqual([
      "stroke",
      "background",
      "shape properties",
      "opacity",
      "layer actions",
    ]);
  });

  it("coalesces the trio of shape rows into one popover", () => {
    // fill, stroke width and stroke style are one button and one popover, the oracle's
    // CombinedShapeProperties — unless none of them applies.
    const onlyColour: ShapeActions = {
      ...fullyCapable,
      fill: false,
      strokeWidth: false,
      strokeStyle: false,
      sloppiness: false,
    };
    expect(mobileActionBarPlan(360, onlyColour).left).not.toContain("shape properties");
  });

  it("keeps undo and redo in the right group always", () => {
    const plan = mobileActionBarPlan(200, rectangle);
    expect(plan.right).toEqual(["undo", "redo"]);
    expect(plan.overflow).toEqual(["duplicate", "delete"]);
  });

  // `MIN_WIDTH = 9 × 32 + 8 × 6 = 336`, `ADDITIONAL_WIDTH = 38`
  // (`Actions.tsx@1118751f:756-770`).
  const MIN_WIDTH = 9 * 32 + 8 * 6;

  it("promotes delete first, then duplicate, as the oracle does", () => {
    expect(mobileActionBarPlan(MIN_WIDTH, rectangle).right).toEqual(["undo", "redo"]);
    expect(mobileActionBarPlan(MIN_WIDTH, rectangle).overflow).toEqual(["duplicate", "delete"]);

    expect(mobileActionBarPlan(MIN_WIDTH + 38, rectangle).right).toEqual([
      "undo",
      "redo",
      "delete",
    ]);
    expect(mobileActionBarPlan(MIN_WIDTH + 38, rectangle).overflow).toEqual(["duplicate"]);

    expect(mobileActionBarPlan(MIN_WIDTH + 76, rectangle).right).toEqual([
      "undo",
      "redo",
      "duplicate",
      "delete",
    ]);
    expect(mobileActionBarPlan(MIN_WIDTH + 76, rectangle).overflow).toEqual([]);
  });

  it("promotes by measured strip width, not by predicate count", () => {
    // The oracle's numbers come off the whole island's box, whatever the selection put
    // in it (`Actions.tsx@1118751f:744-747`), so more properties never move the notch.
    const plan = mobileActionBarPlan(MIN_WIDTH + 38, fullyCapable);
    expect(plan.right).toEqual(["undo", "redo", "delete"]);
  });
});
