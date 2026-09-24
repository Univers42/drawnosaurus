import { describe, expect, it } from "vitest";
import {
  isTextField,
  shortcutLabel,
  styleShortcut,
  zOrderShortcut,
  type StyleShortcutKey,
} from "./shortcuts.ts";

const key = (
  partial: Partial<StyleShortcutKey> & Pick<StyleShortcutKey, "key">,
): StyleShortcutKey => ({
  code: "",
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...partial,
});

const selection = { selected: 1, tool: "select", strokeRow: true, backgroundRow: true };

describe("shortcut labels", () => {
  it("writes a chord as each platform does", () => {
    expect(shortcutLabel("CtrlOrCmd+Alt+C", true)).toBe("⌘⌥C");
    expect(shortcutLabel("CtrlOrCmd+Alt+C", false)).toBe("Ctrl+Alt+C");
    expect(shortcutLabel("CtrlOrCmd+Shift+G", true)).toBe("⌘⇧G");
  });

  it("labels front and back with the oracle's chord for the platform", () => {
    // `actionZindex.tsx@1118751f:109-112`, `:147-150`: Ctrl+Alt is AltGr on many
    // keyboards off a Mac, so there the chord is Ctrl+Shift.
    expect(zOrderShortcut("front", false)).toBe("Ctrl+Shift+]");
    expect(zOrderShortcut("back", false)).toBe("Ctrl+Shift+[");
    expect(zOrderShortcut("front", true)).toBe("⌘⌥]");
    expect(zOrderShortcut("back", true)).toBe("⌘⌥[");
    expect(zOrderShortcut("forward", false)).toBe("Ctrl+]");
    expect(zOrderShortcut("backward", true)).toBe("⌘[");
  });
});

describe("style shortcuts", () => {
  it("copies and pastes styles on Ctrl/Cmd+Alt+C/V, by physical key", () => {
    // On a Mac Option+C types "ç": the character is no use, the key is.
    expect(
      styleShortcut(key({ key: "ç", code: "KeyC", altKey: true, metaKey: true }), selection),
    ).toBe("copyStyles");
    expect(
      styleShortcut(key({ key: "v", code: "KeyV", altKey: true, ctrlKey: true }), selection),
    ).toBe("pasteStyles");
    // The plain chords stay the engine's.
    expect(styleShortcut(key({ key: "c", code: "KeyC", ctrlKey: true }), selection)).toBeNull();
    expect(styleShortcut(key({ key: "ç", code: "KeyC", altKey: true }), selection)).toBeNull();
  });

  it("opens the stroke picker on S and the background picker on G", () => {
    expect(styleShortcut(key({ key: "s" }), selection)).toBe("strokePicker");
    expect(styleShortcut(key({ key: "g" }), selection)).toBe("backgroundPicker");
  });

  it("does nothing with the select tool and nothing selected", () => {
    // `App.tsx@1118751f:5900-5905`.
    const nothing = { ...selection, selected: 0 };
    expect(styleShortcut(key({ key: "g" }), nothing)).toBeNull();
    expect(styleShortcut(key({ key: "s" }), nothing)).toBeNull();
  });

  it("leaves S to the lasso with nothing selected, even under a drawing tool", () => {
    const drawing = { selected: 0, tool: "rectangle", strokeRow: true, backgroundRow: true };
    expect(styleShortcut(key({ key: "s" }), drawing)).toBeNull();
    expect(styleShortcut(key({ key: "g" }), drawing)).toBe("backgroundPicker");
  });

  it("opens no picker for a row that is not showing", () => {
    const arrow = { ...selection, backgroundRow: false };
    expect(styleShortcut(key({ key: "g" }), arrow)).toBeNull();
    expect(styleShortcut(key({ key: "S", shiftKey: true }), selection)).toBeNull();
  });
});

describe("typing", () => {
  it("is a field or an editable element, and nothing else", () => {
    const at = (tagName: string, isContentEditable = false) =>
      ({ tagName, isContentEditable }) as unknown as EventTarget;
    expect(isTextField(at("INPUT"))).toBe(true);
    expect(isTextField(at("TEXTAREA"))).toBe(true);
    expect(isTextField(at("DIV", true))).toBe(true);
    expect(isTextField(at("DIV"))).toBe(false);
    expect(isTextField(null)).toBe(false);
  });
});
