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
 * Where a key was pressed: on the board, in the text being edited on it, or in any other
 * field. A field takes every key as typing; the text editor takes every key but the font
 * size chords.
 */
export type KeyTarget = "board" | "textEditor" | "field";

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
  if (target === "field") return null;
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
