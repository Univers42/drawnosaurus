/**
 * Shortcut labels and the chrome's own style shortcuts.
 *
 * The labels follow the oracle's `getShortcutKey` (`packages/excalidraw/shortcut.ts@1118751f:5-22`)
 * in what they name — `CtrlOrCmd` is Cmd on a Mac and Ctrl elsewhere — written the way
 * this chrome already writes them: glyphs run together on a Mac (`⌘⌥]`), words joined
 * by `+` elsewhere (`Ctrl+Alt+]`).
 */

/** Excalidraw's `isDarwin` (`packages/common/src/editorInterface.ts@1118751f:37`). */
export const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

const MAC_GLYPHS: Record<string, string> = { CtrlOrCmd: "⌘", Alt: "⌥", Shift: "⇧" };

/** `"CtrlOrCmd+Alt+C"` as this platform writes it: `⌘⌥C`, or `Ctrl+Alt+C`. */
export function shortcutLabel(chord: string, mac: boolean = IS_MAC): string {
  const keys = chord.split("+");
  return mac
    ? keys.map((key) => MAC_GLYPHS[key] ?? key).join("")
    : keys.map((key) => (key === "CtrlOrCmd" ? "Ctrl" : key)).join("+");
}

/**
 * The z-order chords as Excalidraw writes them: to the front and back is Cmd+Alt on a
 * Mac and Ctrl+Shift elsewhere, where Ctrl+Alt is AltGr on many keyboards
 * (`actions/actionZindex.tsx@1118751f:109-112`, `:147-150`). The engine's keymap takes
 * both chords on every platform (`engine/src/host/keys.ts`), so either label names one
 * that works.
 */
export function zOrderShortcut(
  mode: "front" | "forward" | "backward" | "back",
  mac: boolean = IS_MAC,
): string {
  const bracket = mode === "front" || mode === "forward" ? "]" : "[";
  if (mode === "forward" || mode === "backward") return shortcutLabel(`CtrlOrCmd+${bracket}`, mac);
  return shortcutLabel(`CtrlOrCmd+${mac ? "Alt" : "Shift"}+${bracket}`, mac);
}

/** Whether a key pressed on `target` is typing, which no shortcut may take. */
export function isTextField(target: EventTarget | null): boolean {
  const element = target as { isContentEditable?: boolean; tagName?: string } | null;
  return (
    !!element &&
    (element.isContentEditable === true || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName ?? ""))
  );
}

/** The `role` an overlay carries, as `closest` wants to be given it. */
const DIALOG = '[role="dialog"]';
const DIALOG_OR_MENU = `${DIALOG}, [role="menu"]`;

function inside(target: EventTarget | null, selector: string): boolean {
  const element = target as { closest?: (selector: string) => unknown } | null;
  return element?.closest?.(selector) != null;
}

/**
 * Whether a key pressed on `target` belongs to an open overlay — a dialog or a menu.
 *
 * An overlay takes the focus when it opens (`Dialog.tsx@1118751f:63-68`,
 * `Popover.tsx@1118751f:44-50`), and that focus is what keeps a key off the board: both
 * the engine's listener and the chrome's ride on a focused element, so a key only reaches
 * them while nothing inside an overlay holds it. The walk is over the ancestors because
 * the target is a control inside the overlay far more often than the overlay itself — a
 * dialog focuses a card with no role of its own.
 *
 * What it answers is "is this key inside an overlay", not "is one open". A key pressed
 * while the focus sits on a toolbar button still gets through, and closing that gap wants
 * the state `DrawModals.svelte` already keeps for Escape, plus a focus trap to go with it.
 */
export function insideOverlay(target: EventTarget | null): boolean {
  return inside(target, DIALOG_OR_MENU);
}

/**
 * Whether a key pressed on `target` belongs to an open dialog — the narrower question the
 * app chords ask, and the reason is `DrawMainMenu.svelte`: it is a `role="menu"` that
 * takes the focus on open and prints `Ctrl+O`, `Ctrl+S`, `Ctrl+Shift+E` and `Alt+S` beside
 * its own items (`:189`, `:200`, `:211`, `:310`). A guard that named menus here made the
 * menu advertise four chords it then ignored, which its own docstring calls worse than
 * printing nothing.
 */
export function insideDialog(target: EventTarget | null): boolean {
  return inside(target, DIALOG);
}

export type StyleShortcut =
  | "copyStyles"
  | "pasteStyles"
  | "strokePicker"
  | "backgroundPicker"
  | "fontPicker"
  | "fontSizeUp"
  | "fontSizeDown";

export interface StyleShortcutKey {
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * Where a key was pressed: on the board, in the text being edited on it, in any other
 * field, or inside an open overlay. A field takes every key as typing; the text editor
 * takes every key but the font size chords; an overlay takes its own, because an open
 * dialog or menu is holding the focus and a menu's keys are the menu's.
 */
export type KeyTarget = "board" | "textEditor" | "field" | "overlay";

/**
 * Ctrl/Cmd+Shift+> and <: `actionIncreaseFontSize` / `actionDecreaseFontSize`, whose
 * `keyTest` takes the comma and full stop too — what the keys print on a Mac with Cmd
 * held (`actions/actionProperties.tsx@1118751f:1110-1117`, `:1133-1140`). The oracle's
 * text editor runs them as well (`wysiwyg/textWysiwyg.tsx@1118751f:675-678`).
 */
function fontSizeShortcut(event: StyleShortcutKey): "fontSizeUp" | "fontSizeDown" | null {
  if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return null;
  if (event.key === ">" || event.key === ".") return "fontSizeUp";
  if (event.key === "<" || event.key === ",") return "fontSizeDown";
  return null;
}

/**
 * What a key does to styles, before the engine sees it — or `null` to let it through.
 *
 * - Ctrl/Cmd+Alt+C and +V copy and paste styles, on `code` as the oracle's are
 *   (`actions/actionStyles.ts@1118751f:78-79`, `:227-228`): with Alt held a Mac types
 *   "ç" and "√". Claimed here because the engine's own Ctrl+C would take the chord for an
 *   element copy.
 * - Ctrl/Cmd+Shift+> and < step the font size, on the board and in the text editor alike
 *   — the one style chord typing reaches.
 * - S opens the stroke picker and G the background picker (`App.tsx@1118751f:5894-5917`).
 *   Divergence: S opens it only for a selection. Our S is also the lasso's key, which
 *   Excalidraw folds into the selection tool, and with nothing selected the key keeps
 *   that meaning.
 * - Shift+F opens the font picker where the font row shows (`App.tsx@1118751f:5921-5950`).
 */
export function styleShortcut(
  event: StyleShortcutKey,
  context: {
    selected: number;
    tool: string;
    strokeRow: boolean;
    backgroundRow: boolean;
    fontRow?: boolean;
    target?: KeyTarget;
  },
): StyleShortcut | null {
  const target = context.target ?? "board";
  // An overlay gets nothing: the colour picker's own S and G pick blue and pink, and the
  // guard on the style chords named only dialogs, so with a menu open they reached the
  // board. The canvas menu and the main menu are `role="menu"` (`DrawContextMenu.svelte`,
  // `DrawMainMenu.svelte`) and are named in `insideOverlay`.
  if (target === "field" || target === "overlay") return null;
  const fontSize = fontSizeShortcut(event);
  if (target === "textEditor" || fontSize) return fontSize;
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.altKey && event.code === "KeyC") return "copyStyles";
  if (mod && event.altKey && event.code === "KeyV") return "pasteStyles";
  if (mod || event.altKey) return null;
  if (context.tool === "select" && context.selected === 0) return null;
  if (event.shiftKey) {
    return event.key.toLowerCase() === "f" && context.fontRow ? "fontPicker" : null;
  }
  if (event.key === "s" && context.selected > 0 && context.strokeRow) return "strokePicker";
  if (event.key === "g" && context.backgroundRow) return "backgroundPicker";
  return null;
}

export type AppShortcut = "snap" | "grid" | "present" | "palette";

export interface AppShortcutKey {
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * The chrome's own global chords that pick a shortcut this app advertises but are neither
 * a canvas edit (the engine's `keys.ts`) nor a style pick (`styleShortcut` above) — see
 * `DrawSurface.svelte`'s `onAppShortcut`, which still owns Escape, Ctrl/Cmd+O, Ctrl/Cmd+S,
 * Ctrl/Cmd+Shift+E and `?` directly: those touch the filesystem or a dialog this registry
 * does not describe. `presenting` suppresses Present's own chord while already showing, so
 * the key does not try to re-enter what it is already in.
 *
 * Snap, grid and Present match `code`, the physical key, as the oracle's grid does, not
 * `key`, the character it types: on AZERTY, QWERTZ or Dvorak the apostrophe is elsewhere
 * or nowhere, and on a Mac Option+S types "ß" and Option+P "π".
 */
export function appShortcut(event: AppShortcutKey, presenting: boolean): AppShortcut | null {
  const mod = event.ctrlKey || event.metaKey;
  if (!mod && event.altKey && event.code === "KeyS") return "snap";
  if (mod && event.code === "Quote") return "grid";
  if (mod && event.altKey && event.code === "KeyP" && !presenting) return "present";
  if (mod && (event.key === "/" || (event.shiftKey && event.key.toLowerCase() === "p"))) {
    return "palette";
  }
  return null;
}
