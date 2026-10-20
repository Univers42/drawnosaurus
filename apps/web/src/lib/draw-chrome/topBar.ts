/**
 * The top bar's plan.
 *
 * The tool bar sits in the middle of the header's row, and the header's two ends share
 * what is left of it. When the row cannot hold the tool bar and both ends, the tool bar
 * takes a row of its own below the header, and the header's row is the width of the
 * screen again.
 *
 * What the ends do when the row is tight is a design call: the oracle's top bar has no
 * title and no status chips, so it has nothing to give way
 * (`LayerUI.tsx@1118751f:239-247` — the menu, the shapes and the right-hand cluster,
 * nothing else). Ours has both, and they give way in this order:
 *
 *  - **the title first** — it is cut short with an ellipsis, the way every title is
 *    everywhere else in this chrome;
 *  - **the status chips next** — they fold into one icon whose label is the full text,
 *    so the words are still there for the screen reader and for the tooltip, and only
 *    the room goes.
 *
 * The Share button keeps its word: it is on the far end of the row, where the space is,
 * and a button that is only an icon is a button nobody is sure of.
 *
 * The widths are measured, not guessed: the caller reads them off the DOM, so the plan
 * is a pure function of what the browser says the parts take.
 */

/** The width a cut title keeps: enough for a word and an ellipsis. */
export const TITLE_MIN = 48;
/** The title's own maximum width — the width it takes when nothing is crowding it. */
export const TITLE_MAX = 180;
/** The width the folded status chip takes: one icon, whatever the statuses say. */
export const FOLDED_CHIPS = 28;

/** What the browser measured, in CSS pixels. */
export interface TopBarWidths {
  /** The width the tool bar takes in the middle of the row. */
  readonly toolbar: number;
  /**
   * The width the header's left end takes without the title's text and without the
   * chips: the menu button, the gap after it and the title's own frame.
   */
  readonly leftFixed: number;
  /** The width the title's own text wants — its natural width, uncut. */
  readonly title: number;
  /** The width the status chips want, unfolded. */
  readonly chips: number;
  /** The width the header's right end takes: Share and Help. */
  readonly right: number;
  /** The gap between the header's parts. */
  readonly gap: number;
  /** The margin the header keeps from the screen's edge. */
  readonly margin: number;
  /** The width of the viewport. */
  readonly viewport: number;
}

export interface TopBarPlan {
  /** Whether the tool bar has a row of its own, below the header. */
  readonly toolbarOwnRow: boolean;
  /** The title's maximum width in the row. */
  readonly titleMaxWidth: number;
  /** Whether the status chips fold into one icon. */
  readonly foldChips: boolean;
}

export function topBarPlan(widths: TopBarWidths): TopBarPlan {
  // The chips and the gap before them, and the same with one icon in place of the chips.
  const chipsBlock = widths.chips > 0 ? widths.chips + widths.gap : 0;
  const foldedBlock = widths.chips > 0 ? widths.gap + FOLDED_CHIPS : 0;

  // The space each end of the row has when the tool bar is in it.
  const side = (widths.viewport - widths.toolbar) / 2 - widths.margin;

  // The ends at their smallest: the title keeps a readable width, the chips are one
  // icon, and the right end is the Share button and the Help button.
  const leftMin = widths.leftFixed + TITLE_MIN + foldedBlock;
  const rightMin = widths.right;

  // A row that cannot hold the tool bar and both ends is not a row: the tool bar takes
  // one of its own, below the header.
  const toolbarOwnRow = side < Math.max(leftMin, rightMin);

  // What the left end may take. With the tool bar in the row, that is the space beside
  // it; with the tool bar on a row of its own, the header's own width less the right
  // end and the gap between them.
  const budget = toolbarOwnRow
    ? widths.viewport - 2 * widths.margin - widths.right - widths.gap
    : side;

  // The title gives way first: it takes what is left of the row.
  let titleMax = budget - widths.leftFixed - chipsBlock;
  let foldChips = false;
  if (titleMax < TITLE_MIN && chipsBlock > 0) {
    // Not even a cut title would fit beside the chips: they fold into one icon and the
    // title takes the room they were taking.
    foldChips = true;
    titleMax = budget - widths.leftFixed - foldedBlock;
  }

  return {
    toolbarOwnRow,
    titleMaxWidth: Math.max(0, Math.min(TITLE_MAX, Math.round(titleMax))),
    foldChips,
  };
}
