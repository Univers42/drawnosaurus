/**
 * Shortcut labels and the chrome's own style shortcuts.
 *
 * The labels follow the oracle's `getShortcutKey` (`packages/excalidraw/shortcut.ts@1118751f:5-22`)
 * in what they name — `CtrlOrCmd` is Cmd on a Mac and Ctrl elsewhere — written the way
 * this chrome already writes them: glyphs run together on a Mac (`⌘⌥]`), words joined
 * by `+` elsewhere (`Ctrl+Shift+]`).
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
 * The z-order chords as the oracle labels them (`actions/actionZindex.tsx@1118751f:46`,
 * `:76`, `:109-112`, `:147-150`): to the front and back is Cmd+Option on a Mac and
 * Ctrl+Shift elsewhere, where Ctrl+Alt is AltGr on many keyboards.
 */
export function zOrderShortcut(
  mode: "front" | "forward" | "backward" | "back",
  mac: boolean = IS_MAC,
): string {
  const bracket = mode === "front" || mode === "forward" ? "]" : "[";
  if (mode === "forward" || mode === "backward") return shortcutLabel(`CtrlOrCmd+${bracket}`, mac);
  return shortcutLabel(mac ? `CtrlOrCmd+Alt+${bracket}` : `CtrlOrCmd+Shift+${bracket}`, mac);
}

/** Whether a key pressed on `target` is typing, which no shortcut may take. */
export function isTextField(target: EventTarget | null): boolean {
  const element = target as { isContentEditable?: boolean; tagName?: string } | null;
  return (
    !!element &&
    (element.isContentEditable === true || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName ?? ""))
  );
}

export type StyleShortcut = "copyStyles" | "pasteStyles" | "strokePicker" | "backgroundPicker";

export interface StyleShortcutKey {
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * What a key does to styles, before the engine sees it — or `null` to let it through.
 *
 * - Ctrl/Cmd+Alt+C and +V copy and paste styles, on `code` as the oracle's are
 *   (`actions/actionStyles.ts@1118751f:78-79`, `:227-228`): with Alt held a Mac types
 *   "ç" and "√". Claimed here because the engine's own Ctrl+C would take the chord for an
 *   element copy.
 * - S opens the stroke picker and G the background picker (`App.tsx@1118751f:5894-5917`).
 *   Divergence: S opens it only for a selection. Our S is also the lasso's key, which
 *   Excalidraw folds into the selection tool, and with nothing selected the key keeps
 *   that meaning.
 */
export function styleShortcut(
  event: StyleShortcutKey,
  context: { selected: number; tool: string; strokeRow: boolean; backgroundRow: boolean },
): StyleShortcut | null {
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.altKey && event.code === "KeyC") return "copyStyles";
  if (mod && event.altKey && event.code === "KeyV") return "pasteStyles";
  if (mod || event.altKey || event.shiftKey) return null;
  if (context.tool === "select" && context.selected === 0) return null;
  if (event.key === "s" && context.selected > 0 && context.strokeRow) return "strokePicker";
  if (event.key === "g" && context.backgroundRow) return "backgroundPicker";
  return null;
}
