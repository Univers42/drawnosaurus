import { describe, expect, it } from "vitest";
import type { TextEditLayout } from "@osionos/draw-engine/types";
import {
  editorBox,
  editorKey,
  indent,
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
  });

  it("indents on Tab and Ctrl+], outdents on Shift+Tab and Ctrl+[", () => {
    expect(editorKey(press({ key: "Tab" }))).toBe("indent");
    expect(editorKey(press({ key: "Tab", shiftKey: true }))).toBe("outdent");
    expect(editorKey(press({ key: "]", code: "BracketRight", ctrlKey: true }))).toBe("indent");
    expect(editorKey(press({ key: "[", code: "BracketLeft", metaKey: true }))).toBe("outdent");
    expect(editorKey(press({ key: "Tab", isComposing: true }))).toBe("hold");
    expect(editorKey(press({ key: "]", code: "BracketRight" }))).toBeNull();
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
  const inside = (selector: string | null, tagName = "BUTTON") => ({
    tagName,
    closest: (wanted: string) => (selector && wanted.includes(selector) ? {} : null),
  });

  it("keeps the edit open for the style panel and the zoom bar, but not for their fields", () => {
    expect(pressKeepsEditor(inside("Style inspector"), 0)).toBe(true);
    expect(pressKeepsEditor(inside("Zoom and history controls"), 0)).toBe(true);
    expect(pressKeepsEditor(inside("Style inspector", "INPUT"), 0)).toBe(false);
  });

  it("ends it for a press anywhere else, unless it is a middle-button pan", () => {
    expect(pressKeepsEditor(inside(null), 0)).toBe(false);
    expect(pressKeepsEditor(inside(null, "CANVAS"), 1)).toBe(true);
    expect(pressKeepsEditor(null, 0)).toBe(false);
  });
});
