import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  camera,
  focusBoard,
  OPEN_CANVAS,
  openBoard,
  pickTool,
  sceneElements,
  selection,
} from "./board.ts";

/**
 * Z-order through the keys — Ctrl+] / Ctrl+[ a step, Ctrl+Shift+] / Ctrl+Shift+[ to the
 * end — on a frame with children and on a group, held to Excalidraw's `zindex.ts`.
 * `ci_zorder.rs` pins the rules with the oracle's own cases; this file presses the keys
 * and checks the order the server is sent.
 *
 * See `docs/reference/zorder.md`.
 */

/** The dev handle's methods this file needs beyond those `board.ts` declares. */
interface ZOrderHandle {
  select(ids: string[]): void;
}

/** A frame F holding C1 and C2, and X outside it: bottom first, as the oracle stacks them. */
const FRAME_BOARD = [
  { id: "C1", type: "rectangle", x: 20, y: 40, width: 60, height: 60, frameId: "F" },
  { id: "C2", type: "rectangle", x: 100, y: 40, width: 60, height: 60, frameId: "F" },
  { id: "F", type: "frame", x: 0, y: 0, width: 200, height: 140, name: "Frame 1" },
  { id: "X", type: "rectangle", x: 260, y: 40, width: 60, height: 60 },
];

/** G1 and G2 grouped, with Y and Z loose above them. */
const GROUP_BOARD = [
  { id: "G1", type: "rectangle", x: 0, y: 0, width: 60, height: 60, groupIds: ["g"] },
  { id: "G2", type: "rectangle", x: 80, y: 0, width: 60, height: 60, groupIds: ["g"] },
  { id: "Y", type: "rectangle", x: 160, y: 0, width: 60, height: 60 },
  { id: "Z", type: "rectangle", x: 240, y: 0, width: 60, height: 60 },
];

async function load(page: Page, elements: Record<string, unknown>[]): Promise<void> {
  await page.evaluate((elements) => {
    const style = {
      angle: 0,
      strokeColor: "#1e1e1e",
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
    };
    const placed = elements.map((element) => ({ ...style, ...element }));
    window.__drawEngine!.loadScene(
      JSON.stringify({ type: "osidraw", version: 1, source: "e2e", elements: placed }),
    );
  }, elements);
}

function select(page: Page, ids: string[]): Promise<void> {
  return page.evaluate((ids) => {
    (window.__drawEngine as unknown as ZOrderHandle).select(ids);
  }, ids);
}

async function stack(page: Page): Promise<string[]> {
  return (await sceneElements(page)).map((element) => element.id);
}

/** Presses `chord` and returns the stack it leaves. */
async function press(page: Page, chord: string): Promise<string[]> {
  await page.keyboard.press(chord);
  return stack(page);
}

test.describe("z-order keys", () => {
  test("a frame child stays inside its frame's stack", async ({ page }) => {
    const board = await openBoard(page);
    await focusBoard(board);
    await load(page, FRAME_BOARD);
    await select(page, ["C1"]);

    // To the front of the frame's range, not of the board (`zindex.ts@1118751f:531-609`).
    expect(await press(page, "Control+Shift+BracketRight")).toEqual(["C2", "F", "C1", "X"]);
    expect(await press(page, "Control+Shift+BracketLeft")).toEqual(["C1", "C2", "F", "X"]);
    expect(await press(page, "Control+BracketRight")).toEqual(["C2", "C1", "F", "X"]);
    expect(await press(page, "Control+BracketLeft")).toEqual(["C1", "C2", "F", "X"]);
  });

  test("a frame moves with its children, and is stepped over whole", async ({ page }) => {
    const board = await openBoard(page);
    await focusBoard(board);
    await load(page, FRAME_BOARD);
    await select(page, ["F"]);

    expect(await press(page, "Control+Shift+BracketRight")).toEqual(["X", "C1", "C2", "F"]);
    expect(await press(page, "Control+Shift+BracketLeft")).toEqual(["C1", "C2", "F", "X"]);
    expect(await press(page, "Control+BracketRight")).toEqual(["X", "C1", "C2", "F"]);
    expect(await press(page, "Control+BracketLeft")).toEqual(["C1", "C2", "F", "X"]);

    // From outside, one step passes the frame and everything in it (`zindex.ts@1118751f:244-255`).
    await select(page, ["X"]);
    expect(await press(page, "Control+BracketLeft")).toEqual(["X", "C1", "C2", "F"]);
    expect(await press(page, "Control+BracketRight")).toEqual(["C1", "C2", "F", "X"]);
  });

  test("a group moves as one block, and is stepped over whole", async ({ page }) => {
    const board = await openBoard(page);
    await focusBoard(board);
    await load(page, GROUP_BOARD);
    await select(page, ["G1", "G2"]);

    expect(await press(page, "Control+BracketRight")).toEqual(["Y", "G1", "G2", "Z"]);
    expect(await press(page, "Control+Shift+BracketRight")).toEqual(["Y", "Z", "G1", "G2"]);
    expect(await press(page, "Control+BracketLeft")).toEqual(["Y", "G1", "G2", "Z"]);
    expect(await press(page, "Control+Shift+BracketLeft")).toEqual(["G1", "G2", "Y", "Z"]);

    await select(page, ["Y"]);
    expect(await press(page, "Control+BracketLeft")).toEqual(["Y", "G1", "G2", "Z"]);
  });

  /**
   * A reorder moves no stamp, so the autosave cannot see it in the elements: it predicts
   * the order the server will reach and sends an explicit one on a mismatch
   * (`apps/web/src/lib/autosave/sceneDiff.ts`). Waited for after the load's own save, or
   * the reorder would ride in that one as new elements appended in order.
   */
  test("a reorder reaches the server as an explicit order", async ({ page }) => {
    const board = await openBoard(page);
    await focusBoard(board);
    const saved = page.waitForResponse((response) => response.request().method() === "PATCH");
    await load(page, FRAME_BOARD);
    await saved;
    await select(page, ["C1"]);

    const ordered = page.waitForRequest(
      (request) =>
        request.method() === "PATCH" &&
        Array.isArray((request.postDataJSON() as { order?: unknown } | null)?.order),
    );
    const final = await press(page, "Control+Shift+BracketRight");
    const body = (await ordered).postDataJSON() as { order: string[] };

    expect(final).toEqual(["C2", "F", "C1", "X"]);
    expect(body.order).toEqual(final);
  });
});

test.describe("what joins a frame", () => {
  /**
   * A shape drawn inside a frame goes directly below it, not on top of the board
   * (`App.tsx@1118751f:7754-7782`, `frame.ts@1118751f:521-536`). That moves it in the
   * stack as it is created: the engine's delta carries the order (`sceneMirror.ts`), and
   * the save carries it on.
   */
  test("a shape drawn in a frame is saved directly below it", async ({ page }) => {
    const board = await openBoard(page);
    await focusBoard(board);
    const { x, y, scale } = await camera(page);
    // The frame's top-left, in world units, 40px inside the open canvas.
    const at = { x: (OPEN_CANVAS.left + 40 - x) / scale, y: (OPEN_CANVAS.top + 40 - y) / scale };
    const saved = page.waitForResponse((response) => response.request().method() === "PATCH");
    await load(page, [
      {
        id: "C1",
        type: "rectangle",
        x: at.x + 20,
        y: at.y + 40,
        width: 60,
        height: 60,
        frameId: "F",
      },
      { id: "F", type: "frame", x: at.x, y: at.y, width: 400, height: 300, name: "Frame 1" },
      { id: "X", type: "rectangle", x: at.x + 460, y: at.y + 40, width: 60, height: 60 },
    ]);
    await saved;

    const ordered = page.waitForRequest(
      (request) =>
        request.method() === "PATCH" &&
        Array.isArray((request.postDataJSON() as { order?: unknown } | null)?.order),
    );
    await pickTool(page, "Rectangle");
    const from = {
      x: board.box.x + OPEN_CANVAS.left + 240,
      y: board.box.y + OPEN_CANVAS.top + 140,
    };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 100, from.y + 80, { steps: 4 });
    await page.mouse.up();

    const [drawn] = await selection(page);
    const final = await stack(page);
    expect(final).toEqual(["C1", drawn, "F", "X"]);
    const body = (await ordered).postDataJSON() as { order: string[] };
    expect(body.order).toEqual(final);
  });
});

/** A world point as an absolute page position, given the camera the engine reports now. */
async function worldToScreen(
  page: Page,
  board: { box: { x: number; y: number } },
  world: { x: number; y: number },
): Promise<{ x: number; y: number }> {
  const { x, y, scale } = await camera(page);
  return { x: board.box.x + world.x * scale + x, y: board.box.y + world.y * scale + y };
}

test.describe("duplicate", () => {
  /**
   * The oracle puts each copy directly above its original (`duplicate.ts@1118751f:
   * 430-436`) — `ci_duplicate.rs` pins the rule through the engine; this checks it reaches
   * the board.
   */
  test("a copy lands directly above its source, not on top of the board", async ({ page }) => {
    const board = await openBoard(page);
    await focusBoard(board);
    await load(page, GROUP_BOARD);
    await select(page, ["Y"]);

    await page.keyboard.press("Control+d");

    const [copy] = await selection(page);
    const final = await stack(page);
    expect(final).toEqual(["G1", "G2", "Y", copy, "Z"]);
  });

  test("a duplicated group lands as one block directly above the group", async ({ page }) => {
    const board = await openBoard(page);
    await focusBoard(board);
    await load(page, GROUP_BOARD);
    await select(page, ["G1", "G2"]);

    await page.keyboard.press("Control+d");

    // `getSelection()` holds a set, not the run's order, so the two copies are checked as
    // a set too: the block sits directly above the group, in front of Y and Z.
    const copies = await selection(page);
    const final = await stack(page);
    expect(final.slice(0, 2)).toEqual(["G1", "G2"]);
    expect(final.slice(4)).toEqual(["Y", "Z"]);
    expect(final.slice(2, 4).sort()).toEqual([...copies].sort());
  });
});

test.describe("right-click on the selection's own frame", () => {
  /**
   * Two grouped rectangles, well inside `OPEN_CANVAS` wherever the camera has settled, and
   * the world point their top-left corner sits at.
   */
  async function twoGroupedRectsInView(page: Page): Promise<{ x: number; y: number }> {
    const { x, y, scale } = await camera(page);
    const at = { x: (OPEN_CANVAS.left + 40 - x) / scale, y: (OPEN_CANVAS.top + 40 - y) / scale };
    await load(page, [
      { id: "G1", type: "rectangle", x: at.x, y: at.y, width: 60, height: 60, groupIds: ["g"] },
      {
        id: "G2",
        type: "rectangle",
        x: at.x + 80,
        y: at.y,
        width: 60,
        height: 60,
        groupIds: ["g"],
      },
    ]);
    return at;
  }

  /**
   * Nothing under the point, but still inside the padded box around the selection: the
   * oracle opens the element menu there too, selection untouched
   * (`isHittingCommonBoundingBoxOfSelectedElements`, `App.tsx@1118751f:9791-9812,
   * 13276-13279`).
   */
  test("opens the element menu and keeps the selection", async ({ page }) => {
    const board = await openBoard(page);
    await focusBoard(board);
    const at = await twoGroupedRectsInView(page);
    await select(page, ["G1", "G2"]);

    // Between G1 (x: at.x to at.x+60) and G2 (x: at.x+80 to at.x+140): inside their
    // common box, on neither shape's own fill or outline.
    const gap = await worldToScreen(page, board, { x: at.x + 70, y: at.y + 30 });
    await page.mouse.click(gap.x, gap.y, { button: "right" });

    await expect(page.getByRole("menuitem", { name: "Duplicate" })).toBeVisible();
    // `getSelection()` holds a set, not the order `select()` was given.
    expect((await selection(page)).sort()).toEqual(["G1", "G2"]);
  });

  /**
   * Nothing under the point and outside the box too: the board menu opens, as it did
   * before, but a right-click runs no selection-clearing path in the oracle at all
   * (`openContextMenu`, `App.tsx@1118751f:13296-13326`) — the menu kind is decided by
   * the hit alone, independent of what stays selected.
   */
  test("opens the board menu and keeps the selection outside that box", async ({ page }) => {
    const board = await openBoard(page);
    await focusBoard(board);
    await twoGroupedRectsInView(page);
    await select(page, ["G1", "G2"]);

    // Far from the rectangles, still inside `OPEN_CANVAS` so the click reaches the canvas.
    const at = {
      x: board.box.x + OPEN_CANVAS.right - 40,
      y: board.box.y + OPEN_CANVAS.bottom - 40,
    };
    await page.mouse.click(at.x, at.y, { button: "right" });

    await expect(page.getByRole("menuitem", { name: "Select all" })).toBeVisible();
    expect((await selection(page)).sort()).toEqual(["G1", "G2"]);
  });
});
