import { describe, expect, it } from "vitest";
import type { DrawElement, DrawElementType } from "@osionos/draw-engine/types";
import { isTransparent } from "./colors.ts";
import {
  getShapeActions,
  isDrawingTool,
  NOTHING_SELECTED,
  type SelectionFacts,
} from "./shapeActions.ts";
import type { ExtendedTool } from "./tools.ts";

type Sel = Pick<DrawElement, "type" | "backgroundColor"> &
  Partial<Pick<DrawElement, "boundTextId">>;

const el = (type: DrawElementType, backgroundColor = "transparent"): Sel => ({
  type,
  backgroundColor,
});

/**
 * What the engine's `selectionStyle()` reports for these elements: a label adds its
 * text to the kinds, and aligns both ways unless it sits on an arrow
 * (`ci_selection_style.rs` pins the engine side).
 */
const factsOf = (selected: readonly Sel[]): SelectionFacts => {
  const kinds = new Set<DrawElementType>();
  const filledKinds = new Set<DrawElementType>();
  for (const element of selected) {
    kinds.add(element.type);
    if (!isTransparent(element.backgroundColor)) filledKinds.add(element.type);
    if (element.boundTextId) kinds.add("text");
  }
  const labelled = selected.some((e) => e.boundTextId && e.type !== "arrow");
  return {
    ...NOTHING_SELECTED,
    count: selected.length,
    kinds: [...kinds],
    filledKinds: [...filledKinds],
    textAlignable: labelled || selected.some((e) => e.type === "text"),
    verticalAlignable: labelled,
  };
};

const actions = (tool: ExtendedTool, selected: Sel[] = [], nextBg = "transparent") =>
  getShapeActions(tool, factsOf(selected), nextBg);

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
    for (const tool of ["select", "hand", "eraser", "lasso", "laser", "frame", "image"] as const) {
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

  it("offers align and distribute exactly when the engine says they would do something", () => {
    // The engine counts units — a group is one, a lone group is what it holds — and
    // refuses a frame, so the element count answers wrong both ways: two grouped
    // shapes are one unit, and a frame with a shape beside it aligns nothing.
    const four = [el("rectangle"), el("ellipse"), el("diamond"), el("rectangle")];
    const units = (canAlign: boolean, canDistribute: boolean) =>
      getShapeActions("select", { ...factsOf(four), canAlign, canDistribute }, "transparent");

    expect(units(true, false).align).toBe(true);
    expect(units(true, false).distribute).toBe(false);
    expect(units(false, false).align).toBe(false);
    expect(units(true, true).distribute).toBe(true);
  });

  it("offers neither without the engine's word", () => {
    const three = actions("select", [el("rectangle"), el("ellipse"), el("diamond")]);

    expect(three.align).toBe(false);
    expect(three.distribute).toBe(false);
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

describe("the lasso is a selection tool, not a drawing one", () => {
  it("shows no style panel on its own", () => {
    // Excalidraw's `showSelectedShapeActions` excludes `lasso` alongside `selection`:
    // there is nothing for a stroke colour to act on while you are still choosing what
    // to act on. It also means the panel cannot sit under the loop you are drawing.
    expect(isDrawingTool("lasso")).toBe(false);
    expect(actions("lasso").visible).toBe(false);
  });

  it("still shows one once the loop has caught something", () => {
    expect(actions("lasso", [el("rectangle")]).visible).toBe(true);
  });
});

describe("the laser draws nothing, so it styles nothing", () => {
  it("shows no style panel", () => {
    // A laser mark never becomes an element, so every control in the panel would be
    // setting a property of something that will not exist. Excalidraw hides the panel
    // for `laser` for the same reason.
    expect(isDrawingTool("laser")).toBe(false);
    expect(actions("laser").visible).toBe(false);
  });

  it("does show one if something was already selected", () => {
    // Picking up the laser mid-edit should not discard the selection you were working
    // on, so the panel stays for as long as that selection does.
    expect(actions("laser", [el("rectangle")]).visible).toBe(true);
  });
});

describe("a frame has a fixed appearance, so it styles nothing but its opacity", () => {
  it("offers a selected frame actions and its opacity, but no style controls", () => {
    // A frame is always the same grey at the same weight, so the stroke and fill
    // controls answer no — Excalidraw excludes frames from those for the same reason.
    // Its opacity is the exception: the oracle offers that row for any selection
    // (`opacity: activeToolType !== "autoshape" || hasSelection`,
    // `shapeActionPredicates.ts@1118751f:157`). What also applies is everything about the
    // frame as an object: send it to back, flip it, group it.
    const actions = getShapeActions("select", factsOf([el("frame")]), "transparent");
    expect(actions.strokeColor).toBe(false);
    expect(actions.backgroundColor).toBe(false);
    expect(actions.strokeWidth).toBe(false);
    expect(actions.roundness).toBe(false);
    expect(actions.opacity).toBe(true);

    expect(actions.visible).toBe(true);
    expect(actions.layers).toBe(true);
    expect(actions.mirror).toBe(true);
  });

  it("offers nothing at all while the frame tool is active with an empty board", () => {
    const actions = getShapeActions("frame", factsOf([]), "transparent");
    expect(actions.visible).toBe(false);
  });

  it("still shows one when a frame is selected alongside something stylable", () => {
    // The controls act on what they can. Hiding the panel because one member of the
    // selection has no stroke colour would make a mixed selection unstylable.
    const actions = getShapeActions(
      "select",
      factsOf([el("frame"), el("rectangle")]),
      "transparent",
    );
    expect(actions.visible).toBe(true);
    expect(actions.strokeColor).toBe(true);
  });
});

describe("opacity, as the oracle offers it", () => {
  it("is offered for any selection and any tool but the auto-shape one", () => {
    // `opacity: activeToolType !== "autoshape" || hasSelection`
    // (`shapeActionPredicates.ts@1118751f:157`): not a list of kinds, so nothing selected
    // is left without the row.
    expect(actions("autoshape").opacity).toBe(false);
    expect(actions("autoshape", [el("rectangle")]).opacity).toBe(true);
    expect(actions("rectangle").opacity).toBe(true);
    expect(actions("select", [el("frame"), el("image")]).opacity).toBe(true);
  });
});

describe("an image is styled by selection, not by its tool", () => {
  it("shows nothing while the picker is open", () => {
    // The image tool lasts exactly as long as a file dialog. A panel that flashes up for
    // that long is noise.
    expect(getShapeActions("image", factsOf([]), "transparent").visible).toBe(false);
  });

  it("offers a selected image its corners and its opacity, and no stroke", () => {
    // An image has no stroke or fill to set, but Excalidraw does let you round its
    // corners and fade it.
    const actions = getShapeActions("select", factsOf([el("image")]), "transparent");
    expect(actions.visible).toBe(true);
    expect(actions.roundness).toBe(true);
    expect(actions.opacity).toBe(true);
    expect(actions.strokeColor).toBe(false);
    expect(actions.backgroundColor).toBe(false);
  });
});

describe("the bucket fill tool", () => {
  // The tool arrived with no entry in any predicate, so every capability came back
  // false while it was active. The panel is gated on those flags row by row, so it
  // rendered as an empty box: there was no way to choose the colour to paint with, and
  // every fill came out the same hardcoded shade. Clicking a filled region a second
  // time then repainted it that identical shade, which looks exactly like a tool that
  // does nothing.
  it("offers a background colour, because that is what it paints with", () => {
    const actions = getShapeActions("bucketfill", factsOf([]), "transparent");
    expect(actions.visible).toBe(true);
    expect(actions.backgroundColor).toBe(true);
  });

  it("offers a fill style even when the shared background is transparent", () => {
    // Excalidraw special-cases exactly this, and says why in situ: "bucket fill never
    // renders transparent (it falls back to a real color), so its fill style stays
    // relevant either way" — `shapeActionPredicates.ts:131-135`. Without the special
    // case the fill row is hidden precisely when nothing has been picked yet, which is
    // every first use of the tool.
    expect(getShapeActions("bucketfill", factsOf([]), "transparent").fill).toBe(true);
    expect(getShapeActions("bucketfill", factsOf([]), "#b2f2bb").fill).toBe(true);
  });

  it("offers opacity", () => {
    expect(getShapeActions("bucketfill", factsOf([]), "transparent").opacity).toBe(true);
  });

  it("offers nothing that paint has no use for", () => {
    // The paint it leaves behind has no stroke at all, so a stroke colour, width or
    // dash would be controls that change nothing. `comparisons.ts:19-64` omits
    // `bucketfill` from every one of them.
    const actions = getShapeActions("bucketfill", factsOf([]), "#b2f2bb");
    expect(actions.strokeColor).toBe(false);
    expect(actions.strokeWidth).toBe(false);
    expect(actions.strokeStyle).toBe(false);
    expect(actions.sloppiness).toBe(false);
    expect(actions.roundness).toBe(false);
    expect(actions.arrowheads).toBe(false);
    expect(actions.text).toBe(false);
  });
});

describe("a shape carrying a label", () => {
  /**
   * The case that made the font and alignment controls unreachable.
   *
   * Once a shape has a label, the shape is the only thing you can select: clicking it
   * selects the container, and the label is not separately selectable. So a predicate
   * that asks "is a text element selected" answers no for every label on the board —
   * the exact case the text controls exist for — and the panel offers them only while
   * the text *tool* happens to be active.
   */
  it("offers the text controls", () => {
    const labelled: Sel & Pick<DrawElement, "boundTextId"> = {
      type: "rectangle",
      backgroundColor: "transparent",
      boundTextId: "el-label",
    };
    expect(getShapeActions("select", factsOf([labelled]), "transparent").text).toBe(true);
  });

  it("still offers everything a rectangle has", () => {
    const labelled: Sel & Pick<DrawElement, "boundTextId"> = {
      type: "rectangle",
      backgroundColor: "transparent",
      boundTextId: "el-label",
    };
    const shown = getShapeActions("select", factsOf([labelled]), "transparent");
    expect(shown.strokeColor).toBe(true);
    expect(shown.roundness).toBe(true);
  });

  it("does not offer them for a shape without one", () => {
    // `boundTextId` absent, and a bare rectangle has no text to format.
    expect(actions("select", [el("rectangle")]).text).toBe(false);
  });
});

describe("text alignment", () => {
  it("offers both alignments for a label in a shape", () => {
    const labelled: Sel = { type: "rectangle", backgroundColor: "transparent", boundTextId: "l" };
    const shown = actions("select", [labelled]);
    expect(shown.textAlign).toBe(true);
    expect(shown.verticalAlign).toBe(true);
  });

  it("offers free text the horizontal one only", () => {
    // `shouldAllowVerticalAlign` is about a label's place in its container; free text
    // has no container to sit in.
    const shown = actions("select", [el("text")]);
    expect(shown.textAlign).toBe(true);
    expect(shown.verticalAlign).toBe(false);
  });

  it("offers an arrow's label neither", () => {
    const labelled: Sel = { type: "arrow", backgroundColor: "transparent", boundTextId: "l" };
    const shown = getShapeActions(
      "select",
      { ...factsOf([labelled]), textAlignable: false, verticalAlignable: false },
      "transparent",
    );
    expect(shown.text).toBe(true);
    expect(shown.textAlign).toBe(false);
    expect(shown.verticalAlign).toBe(false);
  });

  it("offers the horizontal one while the text tool is active", () => {
    expect(actions("text").textAlign).toBe(true);
    expect(actions("text").verticalAlign).toBe(false);
  });
});

describe("oracle predicates", () => {
  it("gives an embed a background, as `hasBackground` does", () => {
    // `packages/element/src/comparisons.ts@1118751f:3-14` lists `embeddable`.
    expect(actions("select", [el("embed")]).backgroundColor).toBe(true);
    expect(actions("select", [el("embed", "#ffc9c9")]).fill).toBe(true);
  });

  it("does not offer a stroke colour for a selected image just because a tool has one", () => {
    // `canChangeStrokeColor` (`shapeActionPredicates.ts@1118751f:41-62`).
    expect(actions("rectangle", [el("image")]).strokeColor).toBe(false);
    expect(actions("rectangle").strokeColor).toBe(true);
  });
});
