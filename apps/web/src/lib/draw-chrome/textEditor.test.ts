import { describe, expect, it } from "vitest";
import type { TextEditLayout } from "@osionos/draw-engine/types";
import {
  editorBox,
  editorKey,
  giveKeysBack,
  indent,
  isWritable,
  normalizeText,
  outdent,
  pressKeepsEditor,
  type EditorText,
} from "./textEditor.ts";

const layout = (partial: Partial<TextEditLayout> = {}): TextEditLayout => ({
  id: "t",
  x: 100,
  y: 50,
  width: 80,
  height: 25,
  fontSize: 20,
  lineHeight: 1.25,
  fontFamily: 5,
  textAlign: "left",
  verticalAlign: "top",
  angle: 0,
  zoom: 1,
  color: "#1e1e1e",
  opacity: 1,
  wrap: false,
  ...partial,
});

const canvas = { width: 1280, height: 800 };

describe("editorBox", () => {
  it("is the text's own box at zoom 1, with 5% height to spare", () => {
    const box = editorBox(layout(), canvas);
    expect(box).toMatchObject({ left: 100, top: 50, width: 80, maxHeight: 750 });
    expect(box.height).toBeCloseTo(26.25);
    expect(box.transform).toBe("translate(0px, 0px) scale(1) rotate(0deg)");
  });

  it("scales about its middle and moves back so the top-left stays on the text's", () => {
    // `getTransform` (`textWysiwyg.tsx@1118751f:80-99`): scaling a 80 × 26.25 box by 2
    // about its middle moves its corner 40 and 13.125 up and left.
    const box = editorBox(layout({ zoom: 2, angle: Math.PI / 2 }), canvas);
    expect(box.transform).toBe("translate(40px, 13.125px) scale(2) rotate(90deg)");
    expect(box.maxHeight).toBe(375);
  });

  it("gives a label half a unit more and stops free text short of the right edge", () => {
    expect(editorBox(layout({ containerId: "box" }), canvas).width).toBe(80.5);
    expect(editorBox(layout({ x: 1250 }), canvas).width).toBe(22);
    expect(editorBox(layout({ x: 1250, zoom: 2 }), canvas).width).toBe(11);
  });

  it("keeps the corner where a tall box is cut at the bottom of the canvas", () => {
    const box = editorBox(layout({ y: 780, height: 100, zoom: 2 }), canvas);
    expect(box.maxHeight).toBe(10);
    expect(box.transform).toBe("translate(40px, 5px) scale(2) rotate(0deg)");
  });
});

const press = (partial: Partial<KeyboardEvent> & { key: string }) => ({
  code: "",
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  isComposing: false,
  keyCode: 0,
  ...partial,
});

describe("editorKey", () => {
  it("ends the edit on Escape and Ctrl/Cmd+Enter, never mid-composition", () => {
    expect(editorKey(press({ key: "Escape" }))).toBe("submit");
    expect(editorKey(press({ key: "Enter", ctrlKey: true }))).toBe("submit");
    expect(editorKey(press({ key: "Enter", metaKey: true }))).toBe("submit");
    expect(editorKey(press({ key: "Enter", ctrlKey: true, isComposing: true }))).toBe("hold");
    expect(editorKey(press({ key: "Enter", ctrlKey: true, keyCode: 229 }))).toBe("hold");
    expect(editorKey(press({ key: "Enter" }))).toBeNull();
    // An IME's own Escape cancels its composition; ours must not also close the whole
    // edit under it — Chromium still forwards the keydown, `isComposing: true`.
    expect(editorKey(press({ key: "Escape", isComposing: true }))).toBe("hold");
    expect(editorKey(press({ key: "Escape", keyCode: 229 }))).toBe("hold");
  });

  it("indents on Tab and Ctrl+], outdents on Shift+Tab and Ctrl+[", () => {
    expect(editorKey(press({ key: "Tab" }))).toBe("indent");
    expect(editorKey(press({ key: "Tab", shiftKey: true }))).toBe("outdent");
    expect(editorKey(press({ key: "]", code: "BracketRight", ctrlKey: true }))).toBe("indent");
    expect(editorKey(press({ key: "[", code: "BracketLeft", metaKey: true }))).toBe("outdent");
    expect(editorKey(press({ key: "Tab", isComposing: true }))).toBe("hold");
    expect(editorKey(press({ key: "]", code: "BracketRight" }))).toBeNull();
  });

  it("ends the edit and saves on Ctrl/Cmd+S, never mid-composition", () => {
    expect(editorKey(press({ key: "s", ctrlKey: true }))).toBe("save");
    expect(editorKey(press({ key: "S", metaKey: true }))).toBe("save");
    expect(editorKey(press({ key: "s", ctrlKey: true, isComposing: true }))).toBe("hold");
    expect(editorKey(press({ key: "s", ctrlKey: true, keyCode: 229 }))).toBe("hold");
    expect(editorKey(press({ key: "s", ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(editorKey(press({ key: "s" }))).toBeNull();
  });

  it("zooms on Ctrl/Cmd with + − 0 and no Shift, by the printed key", () => {
    expect(editorKey(press({ key: "=", ctrlKey: true }))).toBe("zoomIn");
    expect(editorKey(press({ key: "+", ctrlKey: true }))).toBe("zoomIn");
    expect(editorKey(press({ key: "-", metaKey: true }))).toBe("zoomOut");
    expect(editorKey(press({ key: "0", ctrlKey: true }))).toBe("zoomReset");
    // `!event.shiftKey` (`textWysiwyg.tsx@1118751f:663-674`).
    expect(editorKey(press({ key: "+", ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(editorKey(press({ key: "+" }))).toBeNull();
    expect(editorKey(press({ key: "0" }))).toBeNull();
  });

  it("types letters and lets the font-size chord through to the board", () => {
    for (const key of ["a", "s", "g", "1", " ", "Enter", "Backspace"]) {
      expect(editorKey(press({ key }))).toBeNull();
    }
    expect(editorKey(press({ key: "<", ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(editorKey(press({ key: ">", ctrlKey: true, shiftKey: true }))).toBeNull();
  });
});

/** `|` marks the selection's ends in these. */
const text = (marked: string): EditorText => {
  const selectionStart = marked.indexOf("|");
  const selectionEnd =
    marked.lastIndexOf("|") - (selectionStart === marked.lastIndexOf("|") ? 0 : 1);
  return { value: marked.replaceAll("|", ""), selectionStart, selectionEnd };
};
const marked = ({ value, selectionStart, selectionEnd }: EditorText): string =>
  selectionStart === selectionEnd
    ? `${value.slice(0, selectionStart)}|${value.slice(selectionStart)}`
    : `${value.slice(0, selectionStart)}|${value.slice(selectionStart, selectionEnd)}|${value.slice(selectionEnd)}`;

describe("indent and outdent", () => {
  it("indents the caret's line by four spaces and moves the caret with it", () => {
    expect(marked(indent(text("one\ntw|o\nthree")))).toBe("one\n    tw|o\nthree");
  });

  it("indents every line the selection touches", () => {
    expect(marked(indent(text("o|ne\ntwo\nth|ree")))).toBe("    o|ne\n    two\n    th|ree");
  });

  it("outdents up to four spaces a line, leaving an unindented line alone", () => {
    expect(marked(outdent(text("      a|b")))).toBe("  a|b");
    // As the oracle, which moves the caret back a whole tab (`:757-775`).
    expect(marked(outdent(text("  a|b")))).toBe("|ab");
    expect(marked(outdent(text("a|b")))).toBe("a|b");
    expect(marked(outdent(text("    o|ne\ntwo\n    th|ree")))).toBe("o|ne\ntwo\nth|ree");
  });

  it("keeps a caret before the removed spaces where it was", () => {
    // `textWysiwyg.tsx@1118751f:757-775`: the caret is at the line's start, before the tab.
    expect(marked(outdent(text("|    one")))).toBe("|one");
  });

  it("undoes an indent", () => {
    const start = text("a|lpha\nbeta\ngam|ma");
    expect(outdent(indent(start))).toEqual(start);
  });
});

describe("normalizeText", () => {
  it("makes every line end a newline and a tab eight spaces", () => {
    expect(normalizeText("a\r\nb\rc\td")).toBe("a\nb\nc        d");
  });
});

describe("pressKeepsEditor", () => {
  /**
   * A pressed element inside `within` — simple selectors, outermost first — with a
   * `closest` that matches a selector list whose every compound part it sits in.
   */
  const pressed = (within: string[], tagName = "BUTTON", type?: string) => ({
    tagName,
    type,
    closest: (selectors: string) =>
      selectors
        .split(",")
        .some((selector) =>
          (selector.match(/(?:\[[^\]]*\]|[^\s[])+/g) ?? []).every((part) => within.includes(part)),
        )
        ? {}
        : null,
  });
  const PANEL = '[aria-label="Style inspector"]';
  const ZOOM = ".zoom-actions";
  const BAR = '[aria-label="Zoom and history controls"]';

  it("keeps the edit open for the style panel and the zoom buttons", () => {
    expect(pressKeepsEditor(pressed([PANEL]), 0)).toBe(true);
    expect(pressKeepsEditor(pressed([BAR, ZOOM]), 0)).toBe(true);
  });

  it("keeps it for a slider in the panel, which does not take typing (`isWritableElement`)", () => {
    expect(pressKeepsEditor(pressed([PANEL], "INPUT", "range"), 0)).toBe(true);
    expect(pressKeepsEditor(pressed([PANEL], "INPUT", "checkbox"), 0)).toBe(true);
  });

  it("ends it for a field of the panel's own, but not one in the panel's popup", () => {
    expect(pressKeepsEditor(pressed([PANEL], "INPUT", "text"), 0)).toBe(false);
    expect(pressKeepsEditor(pressed([PANEL], "INPUT", "number"), 0)).toBe(false);
    expect(pressKeepsEditor(pressed([PANEL], "TEXTAREA"), 0)).toBe(false);
    expect(pressKeepsEditor(pressed([PANEL, '[role="dialog"]'], "INPUT"), 0)).toBe(true);
  });

  it("ends it for undo and redo, which sit beside the zoom buttons, not among them", () => {
    expect(pressKeepsEditor(pressed([BAR]), 0)).toBe(false);
  });

  it("ends it for a press anywhere else, unless it is a middle-button pan", () => {
    expect(pressKeepsEditor(pressed([]), 0)).toBe(false);
    expect(pressKeepsEditor(pressed(['[role="dialog"]'], "INPUT"), 0)).toBe(false);
    expect(pressKeepsEditor(pressed([], "CANVAS"), 1)).toBe(true);
    expect(pressKeepsEditor(null, 0)).toBe(false);
  });
});

describe("isWritable", () => {
  const element = (tagName: string, type?: string, isContentEditable = false) => ({
    tagName,
    type,
    isContentEditable,
  });

  it("is a textarea, an editable or a text, number, password or search input", () => {
    expect(isWritable(element("TEXTAREA"))).toBe(true);
    expect(isWritable(element("DIV", undefined, true))).toBe(true);
    for (const type of ["text", "number", "password", "search"]) {
      expect(isWritable(element("INPUT", type)), type).toBe(true);
    }
  });

  it("is not a slider, a box to tick, a button or nothing", () => {
    for (const type of ["range", "checkbox", "radio", "color"]) {
      expect(isWritable(element("INPUT", type)), type).toBe(false);
    }
    expect(isWritable(element("BUTTON"))).toBe(false);
    expect(isWritable(element("SELECT"))).toBe(false);
    expect(isWritable(null)).toBe(false);
  });
});

describe("giveKeysBack", () => {
  const root = (present: string[], focused: string[]) => ({
    querySelector: (selector: string) =>
      present.some((name) => selector.includes(name))
        ? { focus: () => void focused.push(selector) }
        : null,
  });

  it("gives the keys to the text being typed while there is one", () => {
    const focused: string[] = [];
    giveKeysBack(root(["Text editor", "application"], focused));
    expect(focused).toEqual(['.draw-chrome textarea[aria-label="Text editor"]']);
  });

  it("gives them to the board otherwise", () => {
    const focused: string[] = [];
    giveKeysBack(root(["application"], focused));
    expect(focused).toEqual(['.draw-chrome [role="application"]']);
  });
});
