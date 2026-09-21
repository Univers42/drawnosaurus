import { describe, expect, it } from "vitest";
import type { DrawElement, DrawElementType } from "@osionos/draw-engine/types";
import { getShapeActions, isDrawingTool, isTransparent } from "./shapeActions.ts";
import type { ExtendedTool } from "./tools.ts";

type Sel = Pick<DrawElement, "type" | "backgroundColor">;

const el = (type: DrawElementType, backgroundColor = "transparent"): Sel => ({
  type,
  backgroundColor,
});

const actions = (tool: ExtendedTool, selected: Sel[] = [], nextBg = "transparent") =>
  getShapeActions(tool, selected, nextBg);

describe("panel visibility", () => {
  it("stays hidden with the select tool and nothing selected", () => {
    // The controls would have nothing to act on, and a panel that is always there is
    // one you stop reading.
    expect(actions("select").visible).toBe(false);
  });

  it("appears for a drawing tool, so defaults can be set before drawing", () => {
    for (const tool of ["rectangle", "ellipse", "arrow", "line", "text", "freedraw"] as const) {
      expect(actions(tool).visible, tool).toBe(true);
    }
  });

  it("appears when something is selected", () => {
    expect(actions("select", [el("rectangle")]).visible).toBe(true);
  });

  it("stays hidden for the tools that create nothing", () => {
    for (const tool of ["select", "hand", "eraser"] as const) {
      expect(actions(tool).visible, tool).toBe(false);
      expect(isDrawingTool(tool), tool).toBe(false);
    }
  });
});

describe("controls follow the element", () => {
  it("an arrow gets arrowheads, and nothing else does", () => {
    expect(actions("select", [el("arrow")]).arrowheads).toBe(true);
    for (const t of ["rectangle", "ellipse", "diamond", "line", "text", "freedraw"] as const) {
      expect(actions("select", [el(t)]).arrowheads, t).toBe(false);
    }
  });

  it("an ellipse has no corners to round", () => {
    // Excalidraw's `canChangeRoundness` deliberately omits it.
    expect(actions("select", [el("ellipse")]).roundness).toBe(false);
    expect(actions("select", [el("rectangle")]).roundness).toBe(true);
    expect(actions("select", [el("diamond")]).roundness).toBe(true);
    expect(actions("select", [el("line")]).roundness).toBe(true);
  });

  it("an arrow has no background to fill", () => {
    expect(actions("select", [el("arrow")]).backgroundColor).toBe(false);
    expect(actions("select", [el("rectangle")]).backgroundColor).toBe(true);
  });

  it("text has a colour but no stroke width or dash pattern", () => {
    const text = actions("select", [el("text")]);
    expect(text.strokeColor).toBe(true);
    expect(text.strokeWidth).toBe(false);
    expect(text.strokeStyle).toBe(false);
    expect(text.text).toBe(true);
  });

  it("a freehand stroke has width but no dash pattern", () => {
    const draw = actions("select", [el("freedraw")]);
    expect(draw.strokeWidth).toBe(true);
    expect(draw.strokeStyle).toBe(false);
    expect(draw.sloppiness).toBe(false);
  });
});

describe("fill style", () => {
  it("is hidden while the background paints nothing", () => {
    expect(actions("select", [el("rectangle", "transparent")]).fill).toBe(false);
    expect(actions("rectangle", [], "transparent").fill).toBe(false);
  });

  it("appears once there is a fill to style", () => {
    expect(actions("select", [el("rectangle", "#ffec99")]).fill).toBe(true);
    expect(actions("rectangle", [], "#ffec99").fill).toBe(true);
  });

  it("treats a zero-alpha hex as no fill", () => {
    expect(isTransparent("#ffffff00")).toBe(true);
    expect(isTransparent("#fff0")).toBe(true);
    expect(isTransparent("#ffffff")).toBe(false);
    expect(actions("select", [el("rectangle", "#ffffff00")]).fill).toBe(false);
  });
});

describe("a mixed selection offers the union", () => {
  it("shows a control that applies to any one of them", () => {
    // Excalidraw's `forToolOrSelection` is `some`, not `every`: hiding a control
    // because one member cannot use it would make it unreachable for the rest.
    const mixed = actions("select", [el("arrow"), el("rectangle", "#ffec99")]);
    expect(mixed.arrowheads).toBe(true);
    expect(mixed.backgroundColor).toBe(true);
    expect(mixed.fill).toBe(true);
    expect(mixed.roundness).toBe(true);
  });
});

describe("arrangement controls", () => {
  it("need something to arrange", () => {
    const none = actions("rectangle");
    expect(none.layers).toBe(false);
    expect(none.group).toBe(false);
    expect(none.mirror).toBe(false);
  });

  it("align needs two, distribute needs three", () => {
    const one = actions("select", [el("rectangle")]);
    const two = actions("select", [el("rectangle"), el("ellipse")]);
    const three = actions("select", [el("rectangle"), el("ellipse"), el("diamond")]);

    expect(one.align).toBe(false);
    expect(two.align).toBe(true);
    expect(two.distribute).toBe(false);
    expect(three.distribute).toBe(true);
  });
});

describe("the active tool preconfigures", () => {
  it("offers a rectangle's controls before one exists", () => {
    const tool = actions("rectangle", [], "#ffec99");
    expect(tool.visible).toBe(true);
    expect(tool.backgroundColor).toBe(true);
    expect(tool.fill).toBe(true);
    expect(tool.roundness).toBe(true);
    expect(tool.arrowheads).toBe(false);
  });

  it("offers arrowheads while the arrow tool is active", () => {
    expect(actions("arrow").arrowheads).toBe(true);
  });

  it("treats the sticky-note tool as the rectangle it builds", () => {
    const sticky = actions("sticky");
    expect(sticky.visible).toBe(true);
    expect(sticky.backgroundColor).toBe(true);
    expect(sticky.roundness).toBe(true);
  });
});
