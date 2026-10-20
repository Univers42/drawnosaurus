/**
 * The bottom bar's plan, at a measured width.
 *
 * Port of the oracle's measured row (`packages/excalidraw/components/MobileToolbar.tsx@1118751f:102-154`):
 * `WIDTH=36`, `GAP=4`, `MIN_TOOLS=7`; text, image and frame join the row as slots appear,
 * and Everything-else lives behind the More trigger, which wears the active extra tool's
 * own icon. Widths in, tools out — pure, so the component only has to render the plan and
 * measure its row.
 */
import type { DrawTool } from "@osionos/draw-engine/types";
import { EXTRA_TOOLS } from "./tools.ts";

/** `WIDTH` (`MobileToolbar.tsx@1118751f:104`). */
export const MOBILE_TOOL_WIDTH = 36;
/** `GAP` (`MobileToolbar.tsx@1118751f:105`). */
export const MOBILE_TOOL_GAP = 4;

/** The bar's fixed slots: every tool the oracle row always shows, plus its two popovers
 *  and the More trigger — `MIN_TOOLS` of them (`MobileToolbar.tsx@1118751f:107-109`). */
const BASE_SLOTS = ["hand", "select", "freedraw", "eraser", "shapes", "lines", "more"] as const;
export type BaseSlot = (typeof BASE_SLOTS)[number];

/** The extras the oracle promotes with room (`MobileToolbar.tsx@1118751f:112-114`),
 *  in promotion order: text beside the bar, then image, then frame. */
export const PROMOTED_TOOLS = ["text", "image", "frame"] as const;
export type PromotedTool = (typeof PROMOTED_TOOLS)[number];

/** The shape family's three, as the trigger remembers them
 *  (`MobileToolbar.tsx@1118751f:52-54`: the default state lives there too). */
export const SHAPE_FAMILY = ["rectangle", "diamond", "ellipse"] as const;
/** The linear pair, remembered the same way (`MobileToolbar.tsx@1118751f:55-57`). */
export const LINEAR_FAMILY = ["arrow", "line"] as const;

/** The measured minimum: `MIN_TOOLS * WIDTH + (MIN_TOOLS - 1) * GAP`
 *  (`MobileToolbar.tsx@1118751f:109`) — 276 CSS px with these constants. */
export const MOBILE_BAR_MIN_WIDTH =
  BASE_SLOTS.length * MOBILE_TOOL_WIDTH + (BASE_SLOTS.length - 1) * MOBILE_TOOL_GAP;
/** One more slot, in pixels: `ADDITIONAL_WIDTH` (`MobileToolbar.tsx@1118751f:110`). */
export const MOBILE_BAR_SLOT_WIDTH = MOBILE_TOOL_WIDTH + MOBILE_TOOL_GAP;

export interface MobileToolbarPlan {
  /** What the bar shows, in order: fixed slots, then the promoted tools, then More. */
  shown: readonly (BaseSlot | PromotedTool)[];
  /** The tools promoted out of More: shown as their own buttons, in bar order. */
  promoted: readonly PromotedTool[];
  /** What More lists, in our extra order, with the promoted ones taken out. */
  overflow: readonly DrawTool[];
  /** Which face each trigger wears: the popover's last-used tool, and More's active extra. */
  wears: {
    shapes: (typeof SHAPE_FAMILY)[number] | DrawTool;
    lines: (typeof LINEAR_FAMILY)[number] | DrawTool;
    /** The More trigger's face, or null when the active tool already sits on the bar. */
    more: DrawTool | null;
  };
}

/** The oracle's promotion thresholds, one per tool (`MobileToolbar.tsx@1118751f:112-114`):
 *  text from `MIN_WIDTH + 40`, image from `MIN_WIDTH + 80`, frame from
 *  `MIN_WIDTH + 120`. */
export function promotedToolCount(width: number): number {
  if (width < MOBILE_BAR_MIN_WIDTH) return 0;
  return Math.min(
    PROMOTED_TOOLS.length,
    Math.floor((width - MOBILE_BAR_MIN_WIDTH) / MOBILE_BAR_SLOT_WIDTH),
  );
}

export function mobileToolbarPlan(
  width: number,
  options: {
    /** The last-used tools the popovers remember (`MobileToolbar.tsx@1118751f:52-57`). */
    shape?: PromotedTool | DrawTool;
    linear?: PromotedTool | DrawTool;
    /** The active tool, so More can wear its face (`MobileToolbar.tsx@1118751f:135-154`). */
    active?: DrawTool;
  } = {},
): MobileToolbarPlan {
  const count = promotedToolCount(width);
  const promoted = PROMOTED_TOOLS.slice(0, count);
  const extraTools = EXTRA_TOOLS.map((entry) => entry.tool);
  const overflow = extraTools.filter((tool) => !(promoted as readonly string[]).includes(tool));

  const extra = extraTools.find((tool) => tool === options.active);
  const onTheBar = promoted.includes(options.active as PromotedTool);

  // The memory falls back to the oracle's own defaults outside the families — a trigger
  // that could be told to wear the eraser would be a bug showing, not hiding one.
  const shape = SHAPE_FAMILY.find((tool) => tool === options.shape) ?? SHAPE_FAMILY[0];
  const linear = LINEAR_FAMILY.find((tool) => tool === options.linear) ?? LINEAR_FAMILY[0];

  return {
    shown: [...BASE_SLOTS.slice(0, 6), ...PROMOTED_TOOLS.slice(0, count), "more"],
    promoted,
    overflow,
    wears: {
      shapes: shape,
      lines: linear,
      // `extraToolSelected ? extraIcon : DotsIcon`
      // (`MobileToolbar.tsx@1118751f:135-154`): the trigger wears the active extra tool's
      // own icon only while that tool is behind More — a text tool promoted onto the row
      // is already on it, and has its own button.
      more: extra && !onTheBar ? extra : null,
    },
  };
}
