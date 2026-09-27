/**
 * Proof that Alt+Z hides what the oracle hides, keeps what it keeps, and refuses to fire
 * where the oracle refuses to.
 *
 * The oracle's zen mode is not "hide every control" — read the table in `zen.ts` before
 * assuming it is. It slides the floating side panels and the furniture on the right and
 * the bottom off the screen and leaves the main menu, the tool strip and the zoom controls
 * where they are. Two of the classes it applies to move nothing at all, because no rule in
 * the oracle's CSS defines them; `zen.ts` records that rather than guessing which way round
 * that was meant.
 */
import { describe, expect, it } from "vitest";
import { ZEN_CHROME, chromeVisible, type ChromeSurface } from "./zen.ts";
import { appShortcut, type KeyTarget } from "./shortcuts.ts";

/** Alt+Z as a browser reports it: the physical key is `KeyZ` whatever the layout. */
const ALT_Z = {
  key: "z",
  code: "KeyZ",
  altKey: true,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
};

const TARGETS: KeyTarget[] = ["board", "textEditor", "field", "overlay"];

describe("the chrome inventory", () => {
  it("names every surface exactly once", () => {
    const surfaces = ZEN_CHROME.map((row) => row.surface);
    expect(new Set(surfaces).size).toBe(surfaces.length);
  });

  it("cites the oracle on every row, so no decision is a guess", () => {
    for (const row of ZEN_CHROME) {
      expect(row.oracle, row.surface).toMatch(/@1118751f:\d/);
    }
  });

  it("keeps the canvas — the one thing the feature is for", () => {
    expect(chromeVisible("canvas", true)).toBe(true);
  });

  it("keeps a way out, so zen mode is never a trap", () => {
    // `shortkey.md:384` hides the chrome; the oracle still leaves a button that gives it
    // back (`Actions.tsx@1118751f:915-931`). Hiding that too would be the trap.
    expect(chromeVisible("exitZenMode", true)).toBe(true);
  });

  it("leaves at least one piece of chrome on screen while zen is on", () => {
    const onScreen = ZEN_CHROME.filter((row) => chromeVisible(row.surface, true));
    expect(onScreen.length).toBeGreaterThan(0);
  });

  it("shows everything when zen is off, so the flag is the only thing that moves it", () => {
    for (const row of ZEN_CHROME) {
      expect(chromeVisible(row.surface, false), row.surface).toBe(true);
    }
  });

  it("changes exactly the rows the table says it hides, and only while zen is on", () => {
    const differs = ZEN_CHROME.filter(
      (row) => chromeVisible(row.surface, true) !== chromeVisible(row.surface, false),
    );
    expect(differs.map((row) => row.surface)).toEqual(
      ZEN_CHROME.filter((row) => row.hidden).map((row) => row.surface),
    );
    expect(differs.length).toBeGreaterThan(0);
  });

  it("hides the style panel and the undo button the oracle slides away", () => {
    // `LayerUI.tsx@1118751f:253-255` (the styles panel) and `Footer.tsx@1118751f:56-58`
    // (the undo/redo row, `--transition-bottom`).
    expect(chromeVisible("inspector", true)).toBe(false);
    expect(chromeVisible("undoButton", true)).toBe(false);
  });

  it("keeps the tool strip, the zoom controls and the top bar", () => {
    // The toolbar only loses its key hints (`Toolbar.scss@1118751f:5-10`); the zoom
    // controls keep theirs, because the class the oracle puts on them
    // (`layer-ui__wrapper__footer-left--transition-left`, `Footer.tsx@1118751f:42`) has no
    // rule in the oracle's CSS; and the top bar never takes a zen class at all.
    expect(chromeVisible("toolbar", true)).toBe(true);
    expect(chromeVisible("zoomBar", true)).toBe(true);
    expect(chromeVisible("header", true)).toBe(true);
  });

  it("keeps the text being edited, the context menu and every dialog", () => {
    // The text editor's container is a sibling of the chrome, not a child
    // (`App.tsx@1118751f:2529-2531`), and `zenModeEnabled` reaches no dialog.
    expect(chromeVisible("textEditor", true)).toBe(true);
    expect(chromeVisible("contextMenu", true)).toBe(true);
    expect(chromeVisible("modals", true)).toBe(true);
  });

  it("throws on a surface it does not know, rather than hiding it by accident", () => {
    expect(() => chromeVisible("nonesuch" as ChromeSurface, true)).toThrow(/nonesuch/);
  });
});

describe("Alt+Z is the zen chord", () => {
  it("resolves to zen on the board", () => {
    expect(appShortcut(ALT_Z, false)).toBe("zen");
  });

  it("takes Shift too, because the oracle's keyTest never asks about it", () => {
    // `actionToggleZenMode.tsx@1118751f:34-35` is `!CTRL_OR_CMD && altKey && code === Z`
    // and nothing more, so Alt+Shift+Z toggles zen mode in Excalidraw as well. Pinning
    // the oracle's rule rather than a tidier one is the point of reading it.
    expect(appShortcut({ ...ALT_Z, shiftKey: true }, false)).toBe("zen");
  });

  it("is not Ctrl/Cmd+Alt+Z, which the oracle's `!CTRL_OR_CMD` rules out", () => {
    expect(appShortcut({ ...ALT_Z, ctrlKey: true }, false)).toBeNull();
    expect(appShortcut({ ...ALT_Z, metaKey: true }, false)).toBeNull();
  });

  it("still toggles while presenting — the flag is the chrome's, not the board's", () => {
    expect(appShortcut(ALT_Z, true)).toBe("zen");
  });
});

describe("the guard: Alt+Z is a chrome key, and the chrome is busy", () => {
  // `App.tsx@1118751f:5516` — the oracle's own `isInputLike` guard wraps the whole of its
  // key dispatch, so no chord fires while a field has the focus. Ours is
  // `isTextField`/`insideDialog` (`shortcuts.ts:41`, `:84`) and the same `KeyTarget` the
  // style chords already answer to (`shortcuts.ts:112`).
  it("does nothing while the text being edited on the board has the focus", () => {
    expect(appShortcut(ALT_Z, false, "textEditor")).toBeNull();
  });

  it("does nothing in any other field", () => {
    expect(appShortcut(ALT_Z, false, "field")).toBeNull();
  });

  it("does nothing inside an open dialog or menu — share, export, the palette", () => {
    expect(appShortcut(ALT_Z, false, "overlay")).toBeNull();
  });

  it("is the only target where it fires", () => {
    expect(TARGETS.map((target) => appShortcut(ALT_Z, false, target))).toEqual([
      "zen",
      null,
      null,
      null,
    ]);
  });

  it("keeps the other app chords behind the same guard", () => {
    // The guard is on the app chords, not bolted onto zen alone: a chord this registry
    // advertises must not fire from inside a dialog either.
    const snap = { ...ALT_Z, key: "s", code: "KeyS" };
    expect(appShortcut(snap, false, "board")).toBe("snap");
    expect(appShortcut(snap, false, "overlay")).toBeNull();
    const palette = { ...ALT_Z, key: "/", code: "Slash", altKey: false, ctrlKey: true };
    expect(appShortcut(palette, false, "overlay")).toBeNull();
  });
});
