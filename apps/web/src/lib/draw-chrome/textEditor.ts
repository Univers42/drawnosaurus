/**
 * The text editor's arithmetic, ported from Excalidraw's `textWysiwyg`
 * (`packages/excalidraw/wysiwyg/textWysiwyg.tsx@1118751f`): where the textarea sits over
 * the text it replaces, what its keys do, and which presses leave it open. The engine lays
 * the text out and grows its shape (`engine/text_session.rs`); the editor only shows it.
 */
import type { TextEditLayout } from "@osionos/draw-engine/types";

export interface EditorBox {
  left: number;
  top: number;
  width: number;
  height: number;
  maxHeight: number;
  transform: string;
}

/**
 * The textarea's box, in world units, placed at the text's unrotated top-left and scaled
 * and turned about its middle — `updateWysiwygStyle` and `getTransform`
 * (`textWysiwyg.tsx@1118751f:80-99`, `:386-431`). A label's box is half a unit wider than
 * the text, free text stops 8px short of the canvas's right edge, and the height has 5%
 * to spare so the last line never scrolls. `canvas` is the canvas's size in CSS px.
 *
 * The translate keeps the scaled box's top-left on the text's: the oracle clamps it to the
 * maximum width when the box is wider, which only a full-width label's extra half unit
 * reaches — here it is always the box as drawn.
 */
export function editorBox(
  layout: TextEditLayout,
  canvas: { width: number; height: number },
): EditorBox {
  const { zoom } = layout;
  const width = layout.containerId
    ? layout.width + 0.5
    : Math.min(layout.width, (canvas.width - 8 - layout.x) / zoom);
  const height = layout.height * 1.05;
  const maxHeight = (canvas.height - layout.y) / zoom;
  const tx = (width * (zoom - 1)) / 2;
  const ty = (Math.min(height, maxHeight) * (zoom - 1)) / 2;
  const degrees = (180 * layout.angle) / Math.PI;
  return {
    left: layout.x,
    top: layout.y,
    width,
    height,
    maxHeight,
    transform: `translate(${tx}px, ${ty}px) scale(${zoom}) rotate(${degrees}deg)`,
  };
}

export type EditorKey =
  "submit" | "save" | "indent" | "outdent" | "zoomIn" | "zoomOut" | "zoomReset" | "hold";

type KeyLike = Pick<
  KeyboardEvent,
  "key" | "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "isComposing" | "keyCode"
>;

/**
 * What a key does in the editor (`textWysiwyg.tsx@1118751f:662-711`); `null` types it.
 * Escape and Ctrl/Cmd+Enter end the edit; Ctrl/Cmd+S ends it and saves, as the oracle's
 * does (`:683-686`); Tab, Shift+Tab and Ctrl/Cmd+] / [ indent and outdent the lines the
 * selection touches; Ctrl/Cmd with + − 0 and no Shift zoom the board, by the printed key
 * as the board's own shortcuts are. `hold` is a key to swallow and ignore — one an input
 * method is still composing: Enter, Tab and Escape all confirm or cancel a composition of
 * their own, and none of the three may reach past it to submit, indent or end the edit
 * (Escape diverges from the oracle here, which lets it through unguarded, `:627-629`).
 * Everything else, the font-size chord included, is the textarea's or goes on up to the
 * board.
 */
export function editorKey(event: KeyLike): EditorKey | null {
  const mod = event.ctrlKey || event.metaKey;
  if (mod && !event.shiftKey) {
    if (event.key === "=" || event.key === "+") return "zoomIn";
    if (event.key === "-") return "zoomOut";
    if (event.key === "0") return "zoomReset";
    if (event.key.toLowerCase() === "s") {
      return event.isComposing || event.keyCode === 229 ? "hold" : "save";
    }
  }
  if (event.key === "Escape") {
    // An IME's own Escape cancels its composition — the browser still forwards the
    // keydown here, and letting it also end the whole edit would close over a
    // composition still in progress (`textWysiwyg.tsx@1118751f:627-629` does not guard
    // this; a real IME's Escape needs to, so it is held rather than ported as-is).
    return event.isComposing || event.keyCode === 229 ? "hold" : "submit";
  }
  if (event.key === "Enter" && mod) {
    return event.isComposing || event.keyCode === 229 ? "hold" : "submit";
  }
  const bracket = mod && (event.code === "BracketLeft" || event.code === "BracketRight");
  if (event.key === "Tab" || bracket) {
    if (event.isComposing) return "hold";
    return event.shiftKey || event.code === "BracketLeft" ? "outdent" : "indent";
  }
  return null;
}

/** The textarea's text and selection. */
export interface EditorText {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

const TAB_SIZE = 4;
const TAB = " ".repeat(TAB_SIZE);
const LEADING_TAB = new RegExp(`^ {1,${TAB_SIZE}}`);

/** Where each line the selection touches starts, last first (`:778-806`). */
function selectedLineStarts({ value, selectionStart, selectionEnd }: EditorText): number[] {
  const before = value.slice(0, selectionStart).match(/[^\n]*$/)?.[0].length ?? 0;
  let start = selectionStart - before;
  const starts = [start];
  for (const line of value.slice(start, selectionEnd).split("\n").slice(0, -1)) {
    start += line.length + 1;
    starts.push(start);
  }
  return starts.reverse();
}

/** Four spaces at the start of every line the selection touches (`:716-732`). */
export function indent(text: EditorText): EditorText {
  const starts = selectedLineStarts(text);
  let value = text.value;
  for (const start of starts) value = `${value.slice(0, start)}${TAB}${value.slice(start)}`;
  return {
    value,
    selectionStart: text.selectionStart + TAB_SIZE,
    selectionEnd: text.selectionEnd + TAB_SIZE * starts.length,
  };
}

/** Up to four leading spaces off every line the selection touches (`:734-776`). */
export function outdent(text: EditorText): EditorText {
  const removed: number[] = [];
  let value = text.value;
  for (const start of selectedLineStarts(text)) {
    const tab = value.slice(start, start + TAB_SIZE).match(LEADING_TAB);
    if (!tab) continue;
    value = `${value.slice(0, start)}${value.slice(start + tab[0].length)}`;
    removed.push(start);
  }
  const first = removed.at(-1);
  if (first === undefined) return { ...text, value };
  const selectionStart =
    text.selectionStart > first
      ? Math.max(text.selectionStart - TAB_SIZE, first)
      : text.selectionStart;
  return {
    value,
    selectionStart,
    selectionEnd: Math.max(selectionStart, text.selectionEnd - TAB_SIZE * removed.length),
  };
}

/**
 * Line ends as `\n` and tabs as eight spaces, so they draw and measure as typed —
 * `normalizeText` (`packages/element/src/textMeasurements.ts@1118751f:64-70`).
 */
export function normalizeText(text: string): string {
  return text.replace(/\r?\n|\r/g, "\n").replace(/\t/g, "        ");
}

/**
 * What a paste of this scene's own clipboard JSON (`.osidraw`,
 * `export/json.rs::scene_to_json`) inserts into the text being typed: the text of the
 * elements it names, not the JSON — `onpaste`, `textWysiwyg.tsx@1118751f:571-606`,
 * `getTextFromElements` (`packages/element/src/textElement.ts@1118751f:573-586`). Free
 * texts and labels both contribute (both are `type: "text"`), joined with a blank line
 * in the order copied; anything else is skipped.
 *
 * `null` for text that is not this scene's JSON — a plain-text clipboard, say — so the
 * caller leaves the browser's own paste alone. `""` for scene JSON with no text at all,
 * which pastes nothing rather than falling back to the raw JSON, matching the oracle's
 * early return once `parsed.elements` held no text.
 */
export function elementsClipboardText(json: string): string | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const { type, elements } = data as { type?: unknown; elements?: unknown };
  if (type !== "osidraw" || !Array.isArray(elements)) return null;
  return elements
    .filter(
      (element): element is { text: string } =>
        typeof element === "object" &&
        element !== null &&
        (element as { type?: unknown }).type === "text" &&
        typeof (element as { text?: unknown }).text === "string",
    )
    .map((element) => element.text)
    .join("\n\n");
}

const WRITABLE_INPUTS = new Set(["text", "number", "password", "search"]);

/**
 * Whether `target` takes typing of its own, so a press on it ends the edit —
 * `isWritableElement` (`packages/common/src/utils.ts@1118751f:99-118`): a textarea,
 * something editable, or a text, number, password or search input. A slider, a box to tick,
 * a list or a button is not.
 */
export function isWritable(target: unknown): boolean {
  const element = target as { tagName?: string; type?: string; isContentEditable?: boolean } | null;
  if (!element) return false;
  if (element.isContentEditable === true || element.tagName === "TEXTAREA") return true;
  return element.tagName === "INPUT" && WRITABLE_INPUTS.has(element.type ?? "text");
}

/**
 * The chrome a press may land in without ending the edit: the style panel, whose changes
 * restyle the text being typed, and the zoom buttons — the oracle's shape-actions menu and
 * zoom actions (`textWysiwyg.tsx@1118751f:962-981`, `ZoomActions` in
 * `components/Actions.tsx@1118751f:884-896`). Undo and redo sit beside the zoom buttons,
 * outside them, as the oracle's do (`components/footer/Footer.tsx@1118751f:48-62`): a press
 * there ends the edit, and the click then undoes it.
 */
const KEEPS_EDITOR_OPEN = '[aria-label="Style inspector"], .zoom-actions';

/**
 * The style panel's popups — the colour picker — keep the edit open even on a field of
 * their own, as the oracle's `.properties-content` does (`textWysiwyg.tsx@1118751f:964-968`).
 */
const PANEL_POPUP = '[aria-label="Style inspector"] [role="dialog"]';

/**
 * Whether a press leaves the editor open (`onPointerDown`, `textWysiwyg.tsx@1118751f:947-998`):
 * a middle-button pan anywhere, a press in one of the style panel's popups, or a press on
 * the style panel or the zoom buttons that is not on a field taking typing of its own. Any
 * other press ends the edit.
 */
export function pressKeepsEditor(
  target: { closest?: (selector: string) => unknown } | null,
  button: number,
): boolean {
  if (button === 1) return true;
  if (!target?.closest) return false;
  if (target.closest(PANEL_POPUP)) return true;
  return Boolean(target.closest(KEEPS_EDITOR_OPEN)) && !isWritable(target);
}

/** The text being typed on the board, then the board itself. */
const EDITOR = '.draw-chrome textarea[aria-label="Text editor"]';
const BOARD = '.draw-chrome [role="application"]';

/**
 * Where the keys go when one of the panel's popups closes: back to the text being typed,
 * while there is one, as the oracle's editor takes the focus back once no popup holds it
 * (`textWysiwyg.tsx@1118751f:1008-1016`); else to the board, so the next key is a board key.
 */
export function giveKeysBack(root: {
  querySelector(selector: string): { focus(): void } | null;
}): void {
  (root.querySelector(EDITOR) ?? root.querySelector(BOARD))?.focus();
}
