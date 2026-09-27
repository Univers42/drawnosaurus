import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  camera,
  clickElement,
  focusBoard,
  listenForPicker,
  openBoard,
  OPEN_CANVAS,
  sceneElements,
  selection,
  type Board,
  type SceneElement,
} from "./board.ts";

/**
 * The keys and the menus, through a real browser.
 *
 * `e2e/shortcuts.spec.ts` already pins the chords and `ci_shortcuts.rs` pins the engine's
 * table. What neither can see is the step in between: a menu item that is printed but not
 * wired, a chord a panel swallows on its way to the handler, a menu that takes the focus
 * and then does not answer the keys. That step is a person with a pointer, so it takes a
 * browser.
 *
 * Every case is pinned the same way round: **read the thing, do the thing, and watch a
 * non-degenerate value change.** An item that is absent, a hint that is empty, a selection
 * of one arbitrary element and a focus that never left its container all pass without the
 * feature being there, so none of those is an assertion here. Chord text is compared as
 * text, never as a measured width — CI's `monospace` is wider than the Docker image's, and
 * a pixel assertion here would have measured the font and nothing else.
 */

const editor = (page: Page) => page.getByRole("application");
const canvasMenu = (page: Page) => page.getByRole("menu", { name: "Canvas menu" });
const mainMenu = (page: Page) => page.getByRole("menu", { name: "Main menu" });

/** A rectangle drawn by hand, for the cases that need something a person made. */
async function drawBox(board: Board, from = { x: 520, y: 240 }): Promise<void> {
  const { page, box } = board;
  await page.getByRole("button", { name: /^Rectangle \(/ }).click();
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + from.x + 140, box.y + from.y + 90, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await sceneElements(page)).length, { timeout: 2_000 }).toBe(1);
}

/** Each fixture a different stroke, so "the styles were pasted" is not the state it was in. */
const STROKES = ["#1e1e1e", "#1971c2", "#e03131"] as const;

/**
 * Two or three rectangles, placed where the camera already is and filled, so the middle of
 * each is a hit target — a transparent shape is hit on its outline only, which would make
 * every case here about the fill rule instead of about the menu.
 *
 * Loaded rather than drawn, because three of the rows below are about *which* elements are
 * selected and grouped, and that is a fixture question, not a gesture one. The clicks that
 * build the selection and the right-click that opens the menu are still real.
 */
async function loadBoxes(
  page: Page,
  options: { grouped?: boolean; count?: number } = {},
): Promise<string[]> {
  const { x, y, scale } = await camera(page);
  const at = { x: (OPEN_CANVAS.left + 60 - x) / scale, y: (OPEN_CANVAS.top + 60 - y) / scale };
  const count = options.count ?? 2;
  const ids = ["A", "B", "C"].slice(0, count);
  return page.evaluate(
    ({ at, ids, strokes, grouped }) => {
      const style = {
        angle: 0,
        backgroundColor: "#a5d8ff",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roughness: 0,
        opacity: 100,
        roundness: null,
        seed: 1,
        version: 1,
        versionNonce: 1,
        updated: 0,
        isDeleted: false,
        type: "rectangle",
        y: at.y,
        width: 90,
        height: 90,
      };
      const elements = ids.map((id, index) => {
        const element: Record<string, unknown> = {
          ...style,
          id,
          strokeColor: strokes[index],
          x: at.x + index * 140,
        };
        // The engine's own `groupIds` array is what makes a group, so this is a real
        // group rather than a label the menu happens to read.
        if (grouped && index < 2) element.groupIds = ["g"];
        return element;
      });
      window.__drawEngine!.loadScene(
        JSON.stringify({ type: "osidraw", version: 1, source: "e2e", elements }),
      );
      return ids;
    },
    { at, ids, strokes: STROKES, grouped: options.grouped ?? false },
  );
}

const ids = async (page: Page) => (await sceneElements(page)).map((element) => element.id);

const groupIds = async (page: Page, index: number): Promise<string[]> =>
  (await sceneElements(page))[index]?.groupIds ?? [];

/**
 * The item carrying this exact label, once its menu is open — asserted present *and*
 * enabled before it is used.
 *
 * Filtered on the label text rather than on the accessible name, because the name is the
 * label and the chord together ("Copy Ctrl+C") and a prefix match on it is ambiguous: the
 * canvas menu's "Copy" is also a prefix of its "Copy styles", and a row that clicked the
 * wrong one would still have passed. The exact text is also what makes "the item is
 * there" mean *this* item: a menu holding only "Copy styles" does not satisfy a filter for
 * the text "Copy".
 */
async function item(page: Page, menu: "canvas" | "main", label: string) {
  const found = (menu === "canvas" ? canvasMenu(page) : mainMenu(page))
    .getByRole("menuitem")
    .filter({ has: page.getByText(label, { exact: true }) });
  await expect(found, `the ${menu} menu offers "${label}"`).toBeVisible();
  await expect(found, `the ${menu} menu's "${label}" is disabled`).toBeEnabled();
  return found;
}

/**
 * What holds the focus, as `role:text`.
 *
 * The role is the half that matters: a menu that keeps the focus on its own `div` still
 * reports every label inside it in `textContent`, so an assertion of the form "the focused
 * element mentions Duplicate" passes on a menu no key ever reached.
 */
const focusIn = (page: Page) =>
  page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!active) return "none";
    return `${active.getAttribute("role") ?? active.tagName}:${(active.textContent ?? "").trim()}`;
  });

// -------------------------------------------------------------------------------------
// design.md:1061 — Backspace deletes
// -------------------------------------------------------------------------------------

test.describe("Backspace deletes the selection", () => {
  // The oracle's one action answers to both keys and to neither with Ctrl/Cmd
  // (`actionDeleteSelected.keyTest`, `actionDeleteSelected.tsx@1118751f:305-307`), and the
  // registry says ours does too — a claim about a branch nothing drove. Both keys in one
  // table, so a handler that quietly dropped the second is red rather than untested.
  for (const key of ["Delete", "Backspace"] as const) {
    test(`${key} takes the selected shape off the board`, async ({ page }) => {
      const board = await openBoard(page);
      await focusBoard(board);
      await drawBox(board);
      await clickElement(board, 0);
      // Non-degenerate on both sides: without this the assertion below also passes over a
      // gesture that selected nothing on a board that was never drawn on.
      expect(await selection(page), "the shape is selected before the key").toHaveLength(1);
      expect(await sceneElements(page), "setup: the board holds one shape").toHaveLength(1);

      await page.keyboard.press(key);

      expect(await sceneElements(page), `${key} deleted nothing`).toHaveLength(0);
    });
  }

  test("Backspace with nothing selected leaves the board alone", async ({ page }) => {
    // The other half of the same branch: a key that deletes the last thing it found rather
    // than the selection. A scene that survives is a scene the key respected.
    const board = await openBoard(page);
    await drawBox(board);
    // A shape the engine has just created is the one it selects, so the click that puts the
    // focus on the board has to come *after* the drawing to leave the selection empty.
    await focusBoard(board);
    expect(await selection(page), "setup: nothing is selected").toHaveLength(0);

    await page.keyboard.press("Backspace");

    expect(await sceneElements(page), "an unselected shape is not the key's business").toHaveLength(
      1,
    );
  });
});

// -------------------------------------------------------------------------------------
// shortkey.md:431 — Ctrl/Cmd+O opens the file picker, and loads what it is given
// -------------------------------------------------------------------------------------

test.describe("Ctrl/Cmd+O", () => {
  test("the board's own chord opens the file picker", async ({ page }) => {
    // `e2e/shortcuts.spec.ts` presses this with the main menu *open*, which exercises the
    // menu's own handler. This is the chord a person presses with nothing open, and it
    // lives in `onAppShortcut` on the window rather than on the editor container — so it
    // is the one the focus and the guards decide.
    const board = await openBoard(page);
    await focusBoard(board);
    await expect(editor(page), "the board holds the focus").toBeFocused();
    await expect(mainMenu(page), "setup: no menu is open").toBeHidden();

    // Held open by listening: a picker nobody answers is dismissed at once, and with it
    // the chord's only observable. See `listenForPicker`.
    const listening = await listenForPicker(page);
    await page.keyboard.press("Control+o");

    await listening.opened;
  });

  test("and the file it is given is the scene that loads", async ({ page }) => {
    // The line reads "Open/load a scene", and a picker that opened proves the first word
    // only. So: save what the board holds, empty the board, hand the chord a file, and read
    // the scene back. An empty board afterwards, or the old shapes, fails.
    const board = await openBoard(page);
    await focusBoard(board);
    await drawBox(board);
    const saved = await page.evaluate(() => window.__drawEngine!.exportJson());
    const wanted: SceneElement[] = JSON.parse(saved).elements;
    expect(wanted, "setup: the board holds a shape to save").toHaveLength(1);

    await page.evaluate(() => window.__drawEngine!.clear());
    expect(await sceneElements(page), "setup: the board is empty").toHaveLength(0);

    const listening = await listenForPicker(page);
    await page.keyboard.press("Control+o");
    const chooser = await listening.opened;
    await chooser.setFiles({
      name: "scene.osidraw",
      mimeType: "application/json",
      buffer: Buffer.from(saved, "utf8"),
    });

    await expect
      .poll(async () => (await sceneElements(page)).map((element) => element.id), {
        message: "the file the chord was given did not load",
      })
      .toEqual(wanted.map((element) => element.id));
    await expect(
      mainMenu(page),
      "the menu the chord opened for the picker is dismissed once the file is read",
    ).toBeHidden();
  });
});

// -------------------------------------------------------------------------------------
// design.md:1412-1430 — the context menu's own items
// -------------------------------------------------------------------------------------

test.describe("the canvas context menu", () => {
  /**
   * One row per item, and the row *is* the difference: which scene makes the item appear,
   * which element to right-click, and what must be observably different afterwards. Eight
   * near-identical tests would have hidden all three of those in eight copies.
   */
  interface MenuRow {
    checklist: string;
    name: string;
    /** Set when the item does not exist; the row is then a reported gap, not a pass. */
    fixme?: string;
    scene: { grouped?: boolean; count?: number };
    /** Which element to right-click, as a scene index. */
    pick: number;
    /** A second element to shift-click, for the items offered on a multi-selection. */
    alsoSelect?: number;
    effect: (page: Page, board: Board) => Promise<void>;
  }

  const ROWS: MenuRow[] = [
    {
      checklist: "design.md:1412",
      name: "Cut",
      // The oracle lists Cut first among the context menu's own items
      // (`App.tsx@1118751f:13760`). Ours has no Cut at all: `DrawContextMenu.svelte`'s
      // element branch opens with Duplicate. Reported, not fixed — §10 Phase 3.4, "if a
      // test exposes a bug, stop and report it".
      fixme: "no Cut in DrawContextMenu.svelte; engine.cutSelection() exists for Ctrl/Cmd+X",
      scene: {},
      pick: 0,
      effect: async (page) => {
        expect(await sceneElements(page), "Cut did not remove the shape").toHaveLength(0);
      },
    },
    {
      checklist: "design.md:1414",
      name: "Copy",
      scene: { count: 1 },
      pick: 0,
      effect: async (page, board) => {
        // The clipboard is the only thing Copy names, and pasting it back is the only way to
        // see it from here: an engine test can call `copySelection()` directly and never
        // touch the menu that called it. Re-selected first — picking the item handed the
        // focus back to the board, and the paste has to reach the engine.
        await clickElement(board, 0);
        await page.keyboard.press("Control+v");
        await expect
          .poll(async () => (await sceneElements(page)).length, {
            message: "Copy wrote nothing the board could paste",
          })
          .toBe(2);
      },
    },
    {
      checklist: "design.md:1416",
      name: "Duplicate",
      scene: {},
      pick: 0,
      effect: async (page) => {
        await expect
          .poll(async () => (await sceneElements(page)).length, {
            message: "Duplicate added nothing",
          })
          .toBe(3);
        expect(
          (await sceneElements(page)).map((element) => element.type),
          "and what it added is a rectangle, like the original",
        ).toEqual(["rectangle", "rectangle", "rectangle"]);
      },
    },
    {
      checklist: "design.md:1418",
      name: "Delete",
      scene: {},
      pick: 0,
      effect: async (page) => {
        expect(await sceneElements(page), "Delete removed nothing").toHaveLength(1);
      },
    },
    {
      // Group is offered on a multi-selection that is not already a group — the oracle's
      // own predicate for the item, and `DrawContextMenu.svelte`'s `element.multi`.
      checklist: "design.md:1420",
      name: "Group",
      scene: { count: 3 },
      pick: 0,
      alsoSelect: 1,
      effect: async (page) => {
        expect(await groupIds(page, 0), "the first member joined a group").toHaveLength(1);
        expect(await groupIds(page, 1), "and so did the second").toHaveLength(1);
        expect(await groupIds(page, 2), "and the one left out did not").toHaveLength(0);
      },
    },
    {
      // …and Ungroup on a selection that is one (`element.grouped`).
      checklist: "design.md:1422",
      name: "Ungroup",
      scene: { grouped: true, count: 3 },
      pick: 0,
      effect: async (page) => {
        expect(await groupIds(page, 0), "the group is gone").toHaveLength(0);
        expect(await groupIds(page, 1), "for both of its members").toHaveLength(0);
      },
    },
    {
      checklist: "design.md:1428",
      name: "Bring forward",
      scene: {},
      pick: 0,
      effect: async (page) => {
        // A is the backmost of the pair; one step forward puts it between B and the front.
        expect(await ids(page), "forward did not swap the pair").toEqual(["B", "A"]);
      },
    },
    {
      checklist: "design.md:1430",
      name: "Send backward",
      scene: {},
      pick: 1,
      effect: async (page) => {
        // B is the frontmost; one step back puts it behind A. The same two ids as the row
        // above, which is the point: same menu, same result, the element picked differs.
        expect(await ids(page), "backward did not swap the pair").toEqual(["B", "A"]);
      },
    },
  ];

  for (const row of ROWS) {
    test(`${row.name} (${row.checklist})`, async ({ page }, testInfo) => {
      if (row.fixme) test.fixme(true, row.fixme);
      const board = await openBoard(page);
      await focusBoard(board);
      await loadBoxes(page, row.scene);
      if (row.alsoSelect !== undefined) {
        await clickElement(board, row.pick);
        await page.keyboard.down("Shift");
        // `clickElement` drives `page.mouse.click`, so a key held on the keyboard is the
        // shift that click sees. Held around the call, not passed to it: `mouse.click`
        // takes no modifiers and ignores one silently, so the selection would stay at one.
        await clickElement(board, row.alsoSelect);
        await page.keyboard.up("Shift");
        expect(await selection(page), "Group needs more than one").toHaveLength(2);
      }

      await clickElement(board, row.pick, { button: "right" });
      await expect(canvasMenu(page), "the right-click opened the menu").toBeVisible();
      const found = await item(page, "canvas", row.name);
      await page.screenshot({ path: testInfo.outputPath(`canvas-menu-${row.name}.png`) });

      await found.click();
      await expect(canvasMenu(page), "picking an item dismisses the menu").toBeHidden();

      await row.effect(page, board);
    });
  }
});

// -------------------------------------------------------------------------------------
// design.md:1447 — the main menu's Export
// -------------------------------------------------------------------------------------

test("the main menu's Export opens the export dialog", async ({ page }, testInfo) => {
  // The oracle's main-menu item is `SaveAsImage` (`main-menu/DefaultItems.tsx@1118751f:133-147`),
  // whose `onSelect` sets `openDialog: { name: "imageExport" }`. Ours is one click through
  // `onOpenExport`, and what has to show up is *that* dialog, not any dialog.
  const board = await openBoard(page);
  await focusBoard(board);
  const dialog = page.getByRole("dialog", { name: "Export Drawing" });
  await expect(dialog, "the export dialog is closed to begin with").toBeHidden();

  await page.getByRole("button", { name: "Open main menu" }).click();
  await expect(mainMenu(page)).toBeVisible();
  const found = await item(page, "main", "Export image…");
  await page.screenshot({ path: testInfo.outputPath("main-menu-export.png") });

  await found.click();

  await expect(dialog, "Export did not open the dialog").toBeVisible();
  await expect(mainMenu(page), "and the menu got out of the way").toBeHidden();
  // Not "something appeared": the three kinds of export the item stands for, each one a
  // button the dialog would be useless without.
  for (const kind of ["PNG Image", "SVG Vector", ".osidraw File"]) {
    await expect(
      dialog.getByText(kind, { exact: false }),
      `the dialog offers ${kind}`,
    ).toBeVisible();
  }
  await expect(dialog.getByRole("button", { name: "Close dialog" })).toBeEnabled();
});

// -------------------------------------------------------------------------------------
// design.md:1874 — arrow keys in both menus
// -------------------------------------------------------------------------------------

test.describe("arrow keys move through a menu", () => {
  /**
   * Two rows, one per menu, because the line says "both". The registry's note on it claims
   * both menus answer ArrowDown/ArrowUp; only one does. The oracle gets its menu
   * navigation from Radix's `DropdownMenuPrimitive` (`DropdownMenuContent.tsx@1118751f:6`)
   * rather than from a keydown handler of its own — the only listener it writes is Escape
   * (`:66-71`) — so what the oracle asks for here is that the arrow keys work, not any one
   * implementation of them.
   */
  interface ArrowRow {
    menu: "main" | "canvas";
    fixme?: string;
    open: (page: Page, board: Board) => Promise<void>;
  }

  const ROWS: ArrowRow[] = [
    {
      menu: "main",
      open: async (page) => {
        await page.getByRole("button", { name: "Open main menu" }).click();
      },
    },
    {
      menu: "canvas",
      // `DrawContextMenu.svelte`'s `onkeydown` answers Escape and nothing else, so the
      // focus stays on the menu's own box and no item is ever reached.
      fixme: "DrawContextMenu.svelte's onkeydown handles Escape only — no ArrowDown/ArrowUp",
      open: async (_page, board) => {
        await clickElement(board, 0, { button: "right" });
      },
    },
  ];

  for (const row of ROWS) {
    test(`the ${row.menu} menu answers ArrowDown and ArrowUp`, async ({ page }, testInfo) => {
      if (row.fixme) test.fixme(true, row.fixme);
      const board = await openBoard(page);
      await focusBoard(board);
      if (row.menu === "canvas") await loadBoxes(page);

      await row.open(page, board);
      const menu = row.menu === "canvas" ? canvasMenu(page) : mainMenu(page);
      await expect(menu, "the menu opened").toBeVisible();
      await expect(menu, "the menu took the focus").toBeFocused();

      // The expectations are the menu's own item texts, read out of the open menu with
      // the same accessor `focusIn` uses, so a failure names the row the arrow reached and
      // a hand-typed label cannot drift from the menu.
      const texts = await menu
        .getByRole("menuitem")
        .evaluateAll((nodes) => nodes.map((node) => (node.textContent ?? "").trim()));
      expect(texts.length, "the menu has items to move between").toBeGreaterThan(1);
      const rowFocused = (index: number) => `menuitem:${texts[index]}`;

      await page.keyboard.press("ArrowDown");
      await expect
        .poll(() => focusIn(page), { message: "ArrowDown reached no item" })
        .toBe(rowFocused(0));
      await page.screenshot({ path: testInfo.outputPath(`${row.menu}-menu-arrowdown.png`) });

      await page.keyboard.press("ArrowDown");
      await expect
        .poll(() => focusIn(page), { message: "a second ArrowDown stayed where it was" })
        .toBe(rowFocused(1));

      await page.keyboard.press("ArrowUp");
      await expect
        .poll(() => focusIn(page), { message: "ArrowUp did not come back" })
        .toBe(rowFocused(0));
    });
  }
});

// -------------------------------------------------------------------------------------
// design.md:1880 — the shortcut text in the menu items, and ? opening help
// -------------------------------------------------------------------------------------

test.describe("the menus print the chord, and the chord is the one that works", () => {
  /**
   * Each row reads the printed chord off the item and then presses *that text*, so a menu
   * printing a chord nobody answers is red. The text is compared against a literal and
   * against an effect; the width it happens to occupy is never asserted on.
   *
   * The canvas menu's `Copy styles` and `Paste styles` hints are the two this file is here
   * for: the registry records that their chords are pressed and their items clicked
   * (`e2e/console.spec.ts`) but that nobody ever *reads* the two hints.
   */
  interface HintRow {
    menu: "main" | "canvas";
    item: string;
    chord: string;
    /** The element whose styles the copy is taken from, for the two style chords. */
    copyFrom?: number;
  }

  const ROWS: HintRow[] = [
    { menu: "main", item: "Open", chord: "Ctrl+O" },
    { menu: "main", item: "Export image…", chord: "Ctrl+Shift+E" },
    { menu: "main", item: "Keyboard shortcuts", chord: "?" },
    { menu: "canvas", item: "Copy styles", chord: "Ctrl+Alt+C", copyFrom: 1 },
    { menu: "canvas", item: "Paste styles", chord: "Ctrl+Alt+V", copyFrom: 1 },
  ];

  for (const row of ROWS) {
    test(`the ${row.menu} menu's "${row.item}" prints ${row.chord} and it works`, async ({
      page,
    }) => {
      const board = await openBoard(page);
      await focusBoard(board);
      await loadBoxes(page, { count: 2 });

      if (row.menu === "main") {
        await page.getByRole("button", { name: "Open main menu" }).click();
      } else {
        await clickElement(board, 1, { button: "right" });
      }
      const menu = row.menu === "main" ? mainMenu(page) : canvasMenu(page);
      await expect(menu, "the menu opened").toBeVisible();

      const found = await item(page, row.menu, row.item);
      // The oracle prints its chords in the same class ours does, and only when the item
      // has one: `DropdownMenuItemContent.tsx@1118751f:28-30`.
      const hint = (await found.locator(".hint, .dropdown-menu-item__shortcut").innerText()).trim();
      expect(hint, `the chord printed beside "${row.item}"`).toBe(row.chord);
      // An item with no hint at all would otherwise satisfy "the text is there" by not
      // printing one.
      expect(hint.length, "the hint is not empty").toBeGreaterThan(0);

      // Pressed on the board rather than in the open menu, because the claim is that the
      // menu names a chord the app answers — the route `e2e/console.spec.ts` takes for the
      // front/back hints.
      await page.keyboard.press("Escape");
      await expect(menu, "the menu closed").toBeHidden();

      if (row.chord === "?") {
        await clickElement(board, 1);
        await page.keyboard.press("?");
        await expect(
          page.getByRole("dialog", { name: "Keyboard Shortcuts" }),
          "the printed ? did not open help",
        ).toBeVisible();
        return;
      }
      if (row.chord === "Ctrl+O") {
        const listening = await listenForPicker(page);
        await page.keyboard.press("Control+o");
        await listening.opened;
        return;
      }
      if (row.chord === "Ctrl+Shift+E") {
        await page.keyboard.press("Control+Shift+e");
        await expect(
          page.getByRole("dialog", { name: "Export Drawing" }),
          "the printed chord did not open the export dialog",
        ).toBeVisible();
        return;
      }
      // The two style chords are two halves of one round trip, so the pair of rows reads
      // two hints and shares one observable. B is copied onto A, which is only a change
      // because the fixture gave the two shapes different strokes.
      await clickElement(board, row.copyFrom ?? 1);
      await page.keyboard.press("Control+Alt+c");
      if (row.chord === "Ctrl+Alt+C") {
        await expect(
          page.getByText("Copied styles."),
          "the printed chord copied nothing",
        ).toBeVisible();
        return;
      }
      await clickElement(board, 0);
      await page.keyboard.press("Control+Alt+v");
      await expect
        .poll(async () => (await sceneElements(page)).map((element) => element.strokeColor), {
          message: "the printed paste-styles chord pasted nothing",
        })
        .toEqual([STROKES[1], STROKES[1]]);
    });
  }

  test("? opens the shortcuts help from the board", async ({ page }, testInfo) => {
    const board = await openBoard(page);
    await focusBoard(board);
    await expect(editor(page), "the board holds the focus").toBeFocused();

    await page.keyboard.press("?");

    const dialog = page.getByRole("dialog", { name: "Keyboard Shortcuts" });
    await expect(dialog, "? did not open help").toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("shortcuts-help.png") });
    // Not "a dialog appeared". The help is the registry rendered, so the chords this file
    // pins are in it as the text the registry derives for them — `editor.delete` from the
    // case above, and the front/forward chords the canvas menu prints.
    for (const chord of ["Delete or Backspace", "Ctrl+Shift+]", "Ctrl+]"]) {
      await expect(
        dialog.locator("kbd", { hasText: chord }).first(),
        `the help does not print ${chord}`,
      ).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await expect(dialog, "Escape closes help").toBeHidden();
  });
});
