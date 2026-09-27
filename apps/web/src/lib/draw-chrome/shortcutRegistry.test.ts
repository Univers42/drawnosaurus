/**
 * Proof that every chord in `shortcutRegistry.ts` is real. Each chord is parsed into the
 * fields a real KeyboardEvent would carry (`parseChord`, below) and run through the
 * handler that actually owns it — the engine's `dispatchKeyDown` (mirroring
 * `engine/src/host/keys.test.ts`'s own `recording()` mock, imported through the alias
 * `apps/web/svelte.config.js` declares), or one of the chrome's own `styleShortcut` /
 * `presentKeyAction` / `appShortcut` / `switchKey` — then asserted to do what the
 * registry's label says. The last section proves the command palette's printed shortcut
 * never drifts from this same registry.
 */
import { describe, expect, it } from "vitest";
import {
  dispatchKeyDown,
  type KeyEngine,
  type KeyEvent,
  type KeySession,
} from "@osionos/draw-engine/host/keys";
import {
  SHORTCUT_REGISTRY,
  groupedShortcuts,
  shortcutFor,
  type ShortcutEntry,
} from "./shortcutRegistry.ts";
import { appShortcut, styleShortcut } from "./shortcuts.ts";
import { presentKeyAction } from "./presentation.ts";
import { switchKey } from "./shapeSwitch.ts";
import { buildCommands, type PaletteHost } from "./commandPalette.ts";
import type { ShapeActions } from "./shapeActions.ts";

function entry(id: string): ShortcutEntry {
  const found = SHORTCUT_REGISTRY.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`shortcutRegistry.test: no entry "${id}"`);
  return found;
}

// --- a registry chord ("CtrlOrCmd+Shift+ArrowUp") as a real KeyboardEvent reports it ---

interface Chord {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

function keyAndCode(token: string, shiftKey: boolean): { key: string; code: string } {
  if (token === "Space") return { key: " ", code: "Space" }; // the registry's readable stand-in
  if (/^[a-zA-Z]$/.test(token)) {
    const upper = token.toUpperCase();
    // A browser's `key` follows Shift for a letter (`keys.test.ts`'s own `z`/`Z` chords);
    // `code` is the physical key, which no modifier changes.
    return { key: shiftKey ? upper : upper.toLowerCase(), code: `Key${upper}` };
  }
  if (/^[0-9]$/.test(token)) return { key: token, code: `Digit${token}` };
  if (token === "[") return { key: token, code: "BracketLeft" };
  if (token === "]") return { key: token, code: "BracketRight" };
  if (token === "'") return { key: token, code: "Quote" };
  return { key: token, code: token };
}

function parseChord(chord: string): Chord {
  const parts = chord.split("+");
  const token = parts[parts.length - 1]!;
  const mods = parts.slice(0, -1);
  const shiftKey = mods.includes("Shift");
  return {
    ...keyAndCode(token, shiftKey),
    ctrlKey: mods.includes("CtrlOrCmd"),
    metaKey: false,
    altKey: mods.includes("Alt"),
    shiftKey,
  };
}

function keyEvent(chord: string): KeyEvent {
  return { ...parseChord(chord), repeat: false };
}

// --- the engine's own recording mock, mirrored from `engine/src/host/keys.test.ts` -----

function session(engine: KeyEngine, extras: Partial<KeySession> = {}): KeySession {
  return { engine, callbacks: {}, spaceHeld: false, ...extras };
}

function recording(
  selection: string[] = [],
  creatingFlowchart = false,
): { engine: KeyEngine; calls: string[] } {
  const calls: string[] = [];
  let locked = false;
  const engine = {
    flowchartCreate: (direction: string) => calls.push(`flowchartCreate:${direction}`),
    flowchartSetShape: (shape: string) => calls.push(`flowchartSetShape:${shape}`),
    flowchartCommit: () => calls.push("flowchartCommit"),
    flowchartCancel: () => calls.push("flowchartCancel"),
    isCreatingFlowchart: () => creatingFlowchart,
    flowchartNavigate: (direction: string) => {
      calls.push(`flowchartNavigate:${direction}`);
      return null;
    },
    flowchartNavigationEnd: () => calls.push("flowchartNavigationEnd"),
    cancelPointer: () => calls.push("cancelPointer"),
    deleteSelection: () => calls.push("deleteSelection"),
    getSelection: () => selection,
    nudgeSelection: (dx: number, dy: number) => calls.push(`nudge:${dx},${dy}`),
    nudgeStep: (shift: boolean) => (shift ? 5 : 1),
    redo: () => calls.push("redo"),
    undo: () => calls.push("undo"),
    selectAll: () => calls.push("selectAll"),
    duplicateSelection: () => calls.push("duplicateSelection"),
    ungroupSelection: () => calls.push("ungroupSelection"),
    groupSelection: () => calls.push("groupSelection"),
    toggleGroupSelection: () => calls.push("toggleGroupSelection"),
    toggleLockSelection: () => calls.push("toggleLockSelection"),
    reorderSelection: (mode: string) => calls.push(`reorder:${mode}`),
    alignSelection: (mode: string) => calls.push(`align:${mode}`),
    canAlign: () => selection.length > 1,
    zoomIn: () => calls.push("zoomIn"),
    zoomOut: () => calls.push("zoomOut"),
    zoomReset: () => calls.push("zoomReset"),
    copySelection: () => {
      calls.push("copySelection");
      return null;
    },
    cutSelection: () => {
      calls.push("cutSelection");
      return null;
    },
    zoomToFit: () => calls.push("zoomToFit"),
    zoomToFitSelectionInViewport: () => calls.push("zoomToFitSelectionInViewport"),
    zoomToFitSelection: () => calls.push("zoomToFitSelection"),
    pageBy: (x: number, y: number) => calls.push(`pageBy:${x},${y}`),
    editSelectedText: () => {
      calls.push("editSelectedText");
      return false;
    },
    flipSelection: (axis: string) => calls.push(`flip:${axis}`),
    setToolLocked: (next: boolean) => {
      locked = next;
      calls.push(`setToolLocked:${next}`);
    },
    getToolLocked: () => locked,
    setTool: (tool: string) => calls.push(`setTool:${tool}`),
    activateTool: (tool: string) => calls.push(`activateTool:${tool}`),
    linearInProgress: () => false,
    finishLinear: () => calls.push("finishLinear"),
  } as unknown as KeyEngine;
  return { engine, calls };
}

describe("registry integrity", () => {
  it("names every chord once", () => {
    const ids = SHORTCUT_REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("groups every entry exactly once, section-first-seen order", () => {
    const groups = groupedShortcuts();
    const total = groups.reduce((sum, group) => sum + group.entries.length, 0);
    expect(total).toBe(SHORTCUT_REGISTRY.length);
    expect(new Set(groups.map((g) => g.section)).size).toBe(groups.length);
  });

  it("binds Alt+Z once, and no other entry claims the key", () => {
    const claiming = SHORTCUT_REGISTRY.filter((e) => e.chords.includes("Alt+Z"));
    expect(claiming.map((e) => e.id)).toEqual(["view.zenMode"]);
  });

  it("wires Alt+Z the way a browser reports it, so the proof below is the real chord", () => {
    // The literal in `zen.test.ts`, tied to this file's own parser — one chord, one
    // description of it, or the two files drift into testing different keys.
    expect(parseChord(entry("view.zenMode").chords[0]!)).toEqual({
      key: "z",
      code: "KeyZ",
      ctrlKey: false,
      metaKey: false,
      altKey: true,
      shiftKey: false,
    });
  });

  it("leaves Alt+Z to the chrome: no other handler in the app answers it", () => {
    // Shadowing is the failure that hides itself — the chord is printed, the registry entry
    // is proven, and the key silently does something else. So the engine and each of the
    // chrome's own handlers are asked directly, and every one of them must decline.
    const chord = entry("view.zenMode").chords[0]!;
    const parsed = parseChord(chord);

    const { engine, calls } = recording();
    expect(dispatchKeyDown(session(engine), keyEvent(chord))).toBe("pass");
    expect(calls).toEqual([]);

    expect(
      styleShortcut(parsed, { selected: 1, tool: "select", strokeRow: true, backgroundRow: true }),
    ).toBeNull();
    expect(switchKey(parsed, { open: false, switchable: true, onBoard: true })).toBeNull();
    expect(presentKeyAction(parsed.key)).toBeNull();
  });
});

describe("tool chords activate the right tool", () => {
  const NOT_A_TOOL = new Set(["tool.lockActive", "tool.editText", "tool.shapeSwitch"]);
  const toolEntries = SHORTCUT_REGISTRY.filter(
    (e) => e.id.startsWith("tool.") && !NOT_A_TOOL.has(e.id),
  );

  for (const { id, chords, label } of toolEntries) {
    const tool = id.slice("tool.".length);
    for (const chord of chords) {
      it(`${chord} activates ${tool} (${label})`, () => {
        const { engine, calls } = recording();
        expect(dispatchKeyDown(session(engine), keyEvent(chord))).toBe("prevent");
        expect(calls).toEqual([`activateTool:${tool}`]);
      });
    }
  }
});

describe("tool lock, edit text, and the shape switch", () => {
  it("Q toggles the tool lock", () => {
    const { engine, calls } = recording();
    expect(dispatchKeyDown(session(engine), keyEvent(entry("tool.lockActive").chords[0]!))).toBe(
      "prevent",
    );
    expect(calls).toEqual(["setToolLocked:true"]);
  });

  it("Enter edits the selected text", () => {
    const { engine, calls } = recording();
    expect(dispatchKeyDown(session(engine), keyEvent(entry("tool.editText").chords[0]!))).toBe(
      "pass", // the mock's `editSelectedText` returns false, same as `keys.test.ts`'s own
    );
    expect(calls).toEqual(["editSelectedText"]);
  });

  it("Tab opens the switch, Shift+Tab steps it back once open (`toolBar.convertElementType`)", () => {
    const [tab, shiftTab] = entry("tool.shapeSwitch").chords;
    expect(switchKey(parseChord(tab!), { open: false, switchable: true, onBoard: true })).toBe(
      "open",
    );
    expect(switchKey(parseChord(shiftTab!), { open: true, switchable: true, onBoard: true })).toBe(
      "back",
    );
  });
});

describe("view zoom and paging chords", () => {
  it("Ctrl/Cmd+=, +-, +0 zoom in, out, and reset", () => {
    const cases: [string, string][] = [
      ["view.zoomIn", "zoomIn"],
      ["view.zoomOut", "zoomOut"],
      ["view.zoomReset", "zoomReset"],
    ];
    for (const [id, call] of cases) {
      const { engine, calls } = recording();
      expect(dispatchKeyDown(session(engine), keyEvent(entry(id).chords[0]!))).toBe("prevent");
      expect(calls).toEqual([call]);
    }
  });

  it("Shift+1/2/3 fit everything, fit the selection in-viewport, and fit the selection", () => {
    const cases: [string, string][] = [
      ["view.zoomToFit", "zoomToFit"],
      ["view.zoomToFitSelectionInViewport", "zoomToFitSelectionInViewport"],
      ["view.zoomToFitSelection", "zoomToFitSelection"],
    ];
    for (const [id, call] of cases) {
      const { engine, calls } = recording();
      expect(dispatchKeyDown(session(engine), keyEvent(entry(id).chords[0]!))).toBe("prevent");
      expect(calls).toEqual([call]);
    }
  });

  it("Page Up/Down page the board, Shift+Page Up/Down page sideways", () => {
    const cases: [string, string][] = [
      ["PageUp", "pageBy:0,-1"],
      ["PageDown", "pageBy:0,1"],
      ["Shift+PageUp", "pageBy:-1,0"],
      ["Shift+PageDown", "pageBy:1,0"],
    ];
    expect(entry("view.movePageUpDown").chords).toEqual(["PageUp", "PageDown"]);
    expect(entry("view.movePageLeftRight").chords).toEqual(["Shift+PageUp", "Shift+PageDown"]);
    for (const [chord, call] of cases) {
      const { engine, calls } = recording();
      expect(dispatchKeyDown(session(engine), keyEvent(chord))).toBe("prevent");
      expect(calls).toEqual([call]);
    }
  });
});

describe("editor chords", () => {
  it("Delete and Backspace both delete the selection", () => {
    for (const chord of entry("editor.delete").chords) {
      const { engine, calls } = recording();
      expect(dispatchKeyDown(session(engine), keyEvent(chord))).toBe("prevent");
      expect(calls).toEqual(["deleteSelection"]);
    }
  });

  it("Ctrl/Cmd+X cuts, +C copies, +A selects all, +D duplicates", () => {
    const cases: [string, string][] = [
      ["editor.cut", "cutSelection"],
      ["editor.copy", "copySelection"],
      ["editor.selectAll", "selectAll"],
      ["editor.duplicate", "duplicateSelection"],
    ];
    for (const [id, call] of cases) {
      const { engine, calls } = recording();
      expect(dispatchKeyDown(session(engine), keyEvent(entry(id).chords[0]!))).toBe("prevent");
      expect(calls).toEqual([call]);
    }
  });

  it("the four z-order chords reorder the selection", () => {
    const REORDER: Record<string, string> = {
      "editor.sendToBack": "back",
      "editor.bringToFront": "front",
      "editor.sendBackward": "backward",
      "editor.bringForward": "forward",
    };
    for (const [id, mode] of Object.entries(REORDER)) {
      for (const chord of entry(id).chords) {
        const { engine, calls } = recording();
        expect(dispatchKeyDown(session(engine), keyEvent(chord))).toBe("prevent");
        expect(calls).toEqual([`reorder:${mode}`]);
      }
    }
  });

  it("the four align chords align a multi-element selection to that edge", () => {
    const EDGE: Record<string, string> = {
      "editor.alignTop": "top",
      "editor.alignBottom": "bottom",
      "editor.alignLeft": "left",
      "editor.alignRight": "right",
    };
    for (const [id, edgeName] of Object.entries(EDGE)) {
      const { engine, calls } = recording(["a", "b"]);
      expect(dispatchKeyDown(session(engine), keyEvent(entry(id).chords[0]!))).toBe("prevent");
      expect(calls).toEqual([`align:${edgeName}`]);
    }
  });

  it("leaves an align chord alone with nothing to align (`alignActionsPredicate`)", () => {
    const { engine, calls } = recording(["one"]);
    expect(dispatchKeyDown(session(engine), keyEvent(entry("editor.alignTop").chords[0]!))).toBe(
      "pass",
    );
    expect(calls).toEqual([]);
  });

  it("Ctrl/Cmd+Shift+L locks/unlocks a selection", () => {
    const { engine, calls } = recording(["id"]);
    expect(dispatchKeyDown(session(engine), keyEvent(entry("editor.toggleLock").chords[0]!))).toBe(
      "prevent",
    );
    expect(calls).toEqual(["toggleLockSelection"]);
  });

  it("Ctrl/Cmd+Z undoes, both redo chords redo", () => {
    const undo = recording();
    expect(dispatchKeyDown(session(undo.engine), keyEvent(entry("editor.undo").chords[0]!))).toBe(
      "prevent",
    );
    expect(undo.calls).toEqual(["undo"]);

    for (const chord of entry("editor.redo").chords) {
      const { engine, calls } = recording();
      expect(dispatchKeyDown(session(engine), keyEvent(chord))).toBe("prevent");
      expect(calls).toEqual(["redo"]);
    }
  });

  it("Ctrl/Cmd+G toggles grouping (this app's own divergence, documented in `keys.ts`), +Shift+G ungroups", () => {
    const group = recording();
    expect(dispatchKeyDown(session(group.engine), keyEvent(entry("editor.group").chords[0]!))).toBe(
      "prevent",
    );
    expect(group.calls).toEqual(["toggleGroupSelection"]);

    const ungroup = recording();
    expect(
      dispatchKeyDown(session(ungroup.engine), keyEvent(entry("editor.ungroup").chords[0]!)),
    ).toBe("prevent");
    expect(ungroup.calls).toEqual(["ungroupSelection"]);
  });

  it("the arrow keys move the selection 1px, 5px with Shift", () => {
    const plain = recording(["id"]);
    for (const chord of entry("editor.moveSelection").chords) {
      dispatchKeyDown(session(plain.engine), keyEvent(chord));
    }
    expect(plain.calls).toEqual(["nudge:0,-1", "nudge:0,1", "nudge:-1,0", "nudge:1,0"]);

    const shifted = recording(["id"]);
    dispatchKeyDown(session(shifted.engine), { ...keyEvent("ArrowUp"), shiftKey: true });
    expect(shifted.calls).toEqual(["nudge:0,-5"]);
  });

  it("Shift+H flips horizontal, Shift+V flips vertical, with a selection", () => {
    const h = recording(["id"]);
    expect(
      dispatchKeyDown(session(h.engine), keyEvent(entry("editor.flipHorizontal").chords[0]!)),
    ).toBe("prevent");
    expect(h.calls).toEqual(["flip:horizontal"]);

    const v = recording(["id"]);
    expect(
      dispatchKeyDown(session(v.engine), keyEvent(entry("editor.flipVertical").chords[0]!)),
    ).toBe("prevent");
    expect(v.calls).toEqual(["flip:vertical"]);
  });
});

describe("flowchart chords", () => {
  it("Ctrl/Cmd+Arrow grows the flowchart in that direction", () => {
    for (const chord of entry("flowchart.create").chords) {
      const { engine, calls } = recording();
      expect(dispatchKeyDown(session(engine), keyEvent(chord))).toBe("prevent");
      expect(calls[0]).toMatch(/^flowchartCreate:(up|down|left|right)$/);
    }
  });

  it("Alt+Arrow navigates it, with one element selected", () => {
    for (const chord of entry("flowchart.navigate").chords) {
      const { engine, calls } = recording(["id"]);
      expect(dispatchKeyDown(session(engine), keyEvent(chord))).toBe("prevent");
      expect(calls[0]).toMatch(/^flowchartNavigate:(up|down|left|right)$/);
    }
  });

  it("Ctrl/Cmd+1/2/3 pick rectangle/diamond/ellipse, only while creating one", () => {
    const shapes = ["rectangle", "diamond", "ellipse"];
    entry("flowchart.shape").chords.forEach((chord, i) => {
      const { engine, calls } = recording([], true);
      expect(dispatchKeyDown(session(engine), keyEvent(chord))).toBe("prevent");
      expect(calls).toEqual([`flowchartSetShape:${shapes[i]}`]);
    });

    const idle = recording([], false);
    expect(
      dispatchKeyDown(session(idle.engine), keyEvent(entry("flowchart.shape").chords[0]!)),
    ).toBe("pass");
    expect(idle.calls).toEqual([]);
  });
});

describe("style chords (owned by the chrome, ahead of the engine)", () => {
  const selection = {
    selected: 1,
    tool: "select",
    strokeRow: true,
    backgroundRow: true,
    fontRow: true,
  };

  it("Ctrl/Cmd+Alt+C copies styles, +Alt+V pastes them", () => {
    expect(styleShortcut(parseChord(entry("editor.copyStyles").chords[0]!), selection)).toBe(
      "copyStyles",
    );
    expect(styleShortcut(parseChord(entry("editor.pasteStyles").chords[0]!), selection)).toBe(
      "pasteStyles",
    );
  });

  it("S opens the stroke picker, G the background picker, with a selection", () => {
    expect(styleShortcut(parseChord(entry("editor.showStroke").chords[0]!), selection)).toBe(
      "strokePicker",
    );
    expect(styleShortcut(parseChord(entry("editor.showBackground").chords[0]!), selection)).toBe(
      "backgroundPicker",
    );
  });

  it("Shift+F opens the font picker, where the font row shows", () => {
    expect(styleShortcut(parseChord(entry("editor.showFonts").chords[0]!), selection)).toBe(
      "fontPicker",
    );
  });

  it("Ctrl/Cmd+Shift+< steps the font size down, +Shift+> steps it up", () => {
    expect(styleShortcut(parseChord(entry("editor.decreaseFontSize").chords[0]!), selection)).toBe(
      "fontSizeDown",
    );
    expect(styleShortcut(parseChord(entry("editor.increaseFontSize").chords[0]!), selection)).toBe(
      "fontSizeUp",
    );
  });
});

describe("app chords (owned by the chrome)", () => {
  it("Alt+S toggles snap", () => {
    expect(appShortcut(parseChord(entry("view.snap").chords[0]!), false)).toBe("snap");
  });

  it("Ctrl/Cmd+' toggles the grid", () => {
    expect(appShortcut(parseChord(entry("view.grid").chords[0]!), false)).toBe("grid");
  });

  it("both command-palette chords open it", () => {
    for (const chord of entry("view.commandPalette").chords) {
      expect(appShortcut(parseChord(chord), false)).toBe("palette");
    }
  });

  it("Ctrl/Cmd+Alt+P presents, unless already presenting", () => {
    const chord = entry("presentation.enter").chords[0]!;
    expect(appShortcut(parseChord(chord), false)).toBe("present");
    expect(appShortcut(parseChord(chord), true)).toBeNull();
  });

  it("Alt+Z toggles zen mode", () => {
    const chord = entry("view.zenMode").chords[0]!;
    expect(chord).toBe("Alt+Z");
    expect(appShortcut(parseChord(chord), false)).toBe("zen");
  });

  it("Alt+Z is declined wherever a field is holding the focus", () => {
    // The oracle's own guard: `App.tsx@1118751f:5516` wraps its key dispatch in
    // `if (!isInputLike(event.target))`, so no chord fires while a field has the focus.
    // `zen.ts` holds the inventory; this holds the trap shut.
    const chord = entry("view.zenMode").chords[0]!;
    for (const target of ["textEditor", "field"] as const) {
      expect(appShortcut(parseChord(chord), false, target), target).toBeNull();
    }
  });

  it("Alt+Z does not toggle while presenting, where the way out of it is hidden", () => {
    // `!presenting`, as the present chord above carries. Presenting hides the exit button
    // and the palette, so a flag set from in there is on with nothing to clear it.
    const chord = entry("view.zenMode").chords[0]!;
    expect(appShortcut(parseChord(chord), true)).toBeNull();
  });

  it("Alt+Z is still reachable from inside a menu, which prints its own chords", () => {
    // The regression this registry's guard caused when the zen chord brought a `KeyTarget`
    // along: `overlay` covers `[role="menu"]`, and the main menu prints `Alt+S` and
    // `Ctrl+Alt+P` beside its items. The two chords below are the ones it took with it.
    const chord = entry("view.zenMode").chords[0]!;
    expect(appShortcut(parseChord(chord), false, "overlay")).toBe("zen");

    const snap = entry("view.snap").chords[0]!;
    const present = entry("presentation.enter").chords[0]!;
    expect(appShortcut(parseChord(snap), false, "overlay"), "Alt+S from the main menu").toBe(
      "snap",
    );
    expect(
      appShortcut(parseChord(present), false, "overlay"),
      "Ctrl+Alt+P from the main menu",
    ).toBe("present");
  });
});

describe("presentation stepping chords", () => {
  it("every 'next' chord steps forward", () => {
    for (const chord of entry("presentation.next").chords) {
      expect(presentKeyAction(parseChord(chord).key)).toBe("next");
    }
  });

  it("every 'prev' chord steps back", () => {
    for (const chord of entry("presentation.prev").chords) {
      expect(presentKeyAction(parseChord(chord).key)).toBe("prev");
    }
  });

  it("Home and End jump to the first and last slide", () => {
    const [home, end] = entry("presentation.firstLast").chords;
    expect(presentKeyAction(parseChord(home!).key)).toBe("home");
    expect(presentKeyAction(parseChord(end!).key)).toBe("end");
  });

  it("B and . blank the screen black, W and , white", () => {
    for (const chord of entry("presentation.black").chords) {
      expect(presentKeyAction(parseChord(chord).key), chord).toBe("black");
    }
    for (const chord of entry("presentation.white").chords) {
      expect(presentKeyAction(parseChord(chord).key), chord).toBe("white");
    }
  });

  it("Escape exits", () => {
    expect(presentKeyAction(parseChord(entry("presentation.exit").chords[0]!).key)).toBe("exit");
  });
});

describe("the command palette prints this registry's own text", () => {
  const host: PaletteHost = {
    setTool: () => {},
    insertShape: () => {},
    insertFigure: () => {},
    zoomIn: () => {},
    zoomOut: () => {},
    zoomReset: () => {},
    zoomToFit: () => {},
    zoomToFitSelectionInViewport: () => {},
    zoomToFitSelection: () => {},
    pickTheme: () => {},
    toggleGrid: () => {},
    toggleObjectsSnap: () => {},
    toggleFocusMode: () => {},
    toggleZenMode: () => {},
    openExport: () => {},
    openTemplates: () => {},
    openMermaid: () => {},
    enterPresent: () => {},
    openPath: () => {},
    presets: [],
    applyStylePreset: () => {},
    // Everything selected and every panel row shown, so every element command is printed.
    selection: {
      can: new Proxy({} as ShapeActions, { get: () => true }),
      element: { locked: false, multi: true, grouped: false },
      switchable: true,
    },
    run: () => {},
    applyStyle: () => {},
    openPicker: () => {},
    openShapeSwitch: () => {},
    copyStyles: () => {},
    stepFontSize: () => {},
  };
  const commands = buildCommands(host);

  it("every element and editor command with a registry entry prints that entry's text", () => {
    const printed = commands.filter((c) => /^(element|editor):/.test(c.id));
    expect(printed.length).toBeGreaterThan(20);
    for (const command of printed) {
      const registryId = `editor.${command.id.split(":")[1]}`;
      if (SHORTCUT_REGISTRY.some((e) => e.id === registryId)) {
        expect(command.shortcut, command.id).toBe(shortcutFor(registryId));
      }
    }
  });

  it("never repeats a command id", () => {
    const ids = commands.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every tool command with a registry entry prints that entry's text", () => {
    const toolCommands = commands.filter((c) => c.id.startsWith("tool:"));
    expect(toolCommands.length).toBeGreaterThan(0);
    for (const command of toolCommands) {
      const registryId = `tool.${command.id.slice("tool:".length)}`;
      if (SHORTCUT_REGISTRY.some((e) => e.id === registryId)) {
        expect(command.shortcut).toBe(shortcutFor(registryId));
      }
    }
  });

  const VIEW_AND_PRESENT_IDS: Record<string, string> = {
    "view:zoomIn": "view.zoomIn",
    "view:zoomOut": "view.zoomOut",
    "view:zoomReset": "view.zoomReset",
    "view:fit": "view.zoomToFit",
    "view:zoomToFitViewport": "view.zoomToFitSelectionInViewport",
    "view:zoomToSelection": "view.zoomToFitSelection",
    "view:grid": "view.grid",
    "view:snap": "view.snap",
    "view:zenMode": "view.zenMode",
    "view:present": "presentation.enter",
  };

  for (const [commandId, registryId] of Object.entries(VIEW_AND_PRESENT_IDS)) {
    it(`${commandId}'s shortcut equals shortcutFor("${registryId}")`, () => {
      const command = commands.find((c) => c.id === commandId);
      expect(command?.shortcut).toBe(shortcutFor(registryId));
    });
  }
});
