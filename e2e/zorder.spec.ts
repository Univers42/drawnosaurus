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

    // To the front of the frame's range, not of the board (`zindex.ts:543-621`).
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

    // From outside, one step passes the frame and everything in it (`zindex.ts:256-267`).
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
   * stack as it is created, which a delta cannot say: the save carries the order.
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
