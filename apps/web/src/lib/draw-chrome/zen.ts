/**
 * Zen mode: which chrome goes, and which stays.
 *
 * The oracle does not hide every control, and reading it that way is the easy mistake.
 * `actionToggleZenMode.tsx@1118751f:18-26` flips one flag, and what that flag reaches is
 * CSS and a class here and there — the panels carry a `zen-mode-transition` plus a
 * direction, and the direction is a `transform: translate(±999px, 0)`
 * (`LayerUI.scss@1118751f:44-63`). Two surfaces are flattened rather than moved
 * (`Island.scss@1118751f:11-13`, `DropdownMenu.scss@1118751f:52-55`), and two are simply
 * not rendered while the flag is on (the stats panel, `LayerUI.tsx@1118751f:305-310`; the
 * welcome screen, `App.tsx@1118751f:2511-2518`).
 *
 * The table below is that inventory, read off the oracle and mapped onto this app's
 * chrome. Two of the rows are worth reading twice, because the class the oracle applies
 * moves nothing:
 *
 * - `layer-ui__wrapper__footer-left--transition-left` (`Footer.tsx@1118751f:42`) has no rule
 *   in the oracle's CSS. Only `--transition-bottom` is defined (`LayerUI.scss@1118751f:61-63`),
 *   and it is on the undo/redo row, not the zoom actions beside it. So the oracle's zen mode
 *   takes the undo and redo buttons and leaves the zoom controls alone.
 * - `MenuTrigger` sets `zen-mode-transition` with no direction at all
 *   (`DropdownMenuTrigger.tsx@1118751f:19-24`), so its triggers do not move either.
 *
 * Both are recorded as the oracle behaves, not as it was presumably meant to. A future
 * change to the oracle's CSS would change these two rows and nothing else in the table.
 *
 * `zen.ts` is a host concern and stays in the front: the flag is a boolean on this chrome,
 * the canvas is untouched, and nothing here computes a scale, a rect or a coordinate.
 */

/** One piece of chrome, as this app's template gates it. */
export type ChromeSurface =
  /** The top bar: the menu trigger, the title, Share, the shortcuts button. */
  | "header"
  /** The tool strip. Zen mode takes its key hints, not the tools. */
  | "toolbar"
  /** The style panel that slides out of the top left. */
  | "inspector"
  /** The zoom controls along the bottom. */
  | "zoomBar"
  /** The undo button that shares the zoom bar's row. */
  | "undoButton"
  /** The presentation path panel — ours, and a side panel of the same kind. */
  | "pathPanel"
  /** The board itself, and everything laid out on it. */
  | "canvas"
  /** The text being edited on the board. */
  | "textEditor"
  /** The canvas menu. */
  | "contextMenu"
  /** Every dialog: Share, export, templates, Mermaid, the shortcuts list, the palette. */
  | "modals"
  /** The way back out. Shown only while zen mode is on. */
  | "exitZenMode";

export interface ZenChromeRow {
  surface: ChromeSurface;
  /** Whether zen mode takes this surface off the screen. */
  hidden: boolean;
  /** Where the oracle decides it. */
  oracle: string;
}

export const ZEN_CHROME: readonly ZenChromeRow[] = [
  {
    surface: "header",
    hidden: false,
    // The top-left wrapper never takes a zen class (`LayerUI.tsx@1118751f:241-244`), so
    // the main menu stays put; its island only loses its shadow (`Island.scss@1118751f:11-13`).
    oracle: "LayerUI.tsx@1118751f:241-244",
  },
  {
    surface: "toolbar",
    hidden: false,
    // "zen-mode" lands on the toolbar *container* and hides two things inside it — the
    // keybinding badges and the hint viewer — and nothing else.
    oracle: "Toolbar.tsx@1118751f:250",
  },
  {
    surface: "inspector",
    hidden: true,
    // "transition-left" → `translate(-999px, 0)`.
    oracle: "LayerUI.tsx@1118751f:253-255",
  },
  {
    surface: "zoomBar",
    hidden: false,
    // The class the oracle puts on the footer left, `…--transition-left`, is defined by no
    // rule, so the zoom actions do not move.
    oracle: "Footer.tsx@1118751f:40-42",
  },
  {
    surface: "undoButton",
    hidden: true,
    // Undo and redo take `--transition-bottom` → `translate(0, 92px)`, the one footer row
    // the oracle's CSS does define.
    oracle: "Footer.tsx@1118751f:56-58",
  },
  {
    surface: "pathPanel",
    hidden: true,
    // Ours: the oracle has no presentation mode and so no path panel. It is the same kind
    // of floating side panel as the style panel, and "focus on the canvas"
    // (`shortkey.md:384`) reads the same way about it.
    oracle: "LayerUI.tsx@1118751f:253-255",
  },
  {
    surface: "canvas",
    hidden: false,
    // The point of the flag: `shortkey.md:384`, "focus on the canvas".
    oracle: "actionToggleZenMode.tsx@1118751f:9-27",
  },
  {
    surface: "textEditor",
    hidden: false,
    // The text editor's container is a sibling of the whole chrome, not a child of it, so
    // no zen rule reaches it — and a text box that vanishes mid-sentence is the trap this
    // feature is most likely to fall into.
    oracle: "App.tsx@1118751f:2529-2531",
  },
  {
    surface: "contextMenu",
    hidden: false,
    // Likewise a sibling container; `zenModeEnabled` appears in no menu code.
    oracle: "App.tsx@1118751f:2530",
  },
  {
    surface: "modals",
    hidden: false,
    // `zenModeEnabled` reaches no dialog. The one line that reads it for a dialog's sake
    // only decides whether the exit button shows.
    oracle: "App.tsx@1118751f:2505-2508",
  },
  {
    surface: "exitZenMode",
    hidden: false,
    // "disable-zen-mode" is `opacity: 0; visibility: hidden` until it gains
    // "disable-zen-mode--visible", so the way out appears with the flag and only with it.
    oracle: "Actions.tsx@1118751f:915-931",
  },
];

function rowFor(surface: ChromeSurface): ZenChromeRow {
  const row = ZEN_CHROME.find((candidate) => candidate.surface === surface);
  if (!row) throw new Error(`zen: no chrome surface "${surface}"`);
  return row;
}

/**
 * Whether `surface` is on screen, given the flag. The only thing this answers: with zen
 * mode off every surface is visible, exactly as before the feature existed, so the flag
 * is the single thing that moves the chrome.
 */
export function chromeVisible(surface: ChromeSurface, zenMode: boolean): boolean {
  return zenMode ? !rowFor(surface).hidden : true;
}
