import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  OPEN_CANVAS,
  focusBoard,
  openBoard,
  sceneElements,
  selection,
  type Board,
  type SceneElement,
} from "./board.ts";

/**
 * Ctrl/Cmd+Arrow builds a connected node, Alt+Arrow walks the graph — ported from the
 * oracle's `App.flowchart.ts@1118751f`. `ci_flowchart.rs` pins the geometry and the
 * binding rules structurally; this is the half only a real browser can check: that a
 * genuine keydown/keyup reaches `dispatchKeyDown`/`dispatchKeyUp`
 * (`engine/src/host/keys.ts`) through the DOM, that the pending preview commits as one
 * step, and that the digit-key shape choice — an extra the oracle lacks — actually
 * switches what lands.
 *
 * See `docs/reference/flowchart.md`.
 */

const editor = (page: Page) => page.locator("textarea[aria-label='Text editor']");

/** The debug handle's `select`, which `board.ts`'s own declaration leaves out. */
interface SelectHandle {
  select(ids: string[]): void;
}

/** Places one rectangle, selected, at a canvas point — the start of a flowchart. */
async function placeStartingRectangle(
  board: Board,
  id: string,
  at: { x: number; y: number },
): Promise<void> {
  await board.page.evaluate(
    ({ id, at }) => {
      const engine = window.__drawEngine!;
      const world = engine.screenToWorld(at.x, at.y);
      engine.loadScene(
        JSON.stringify({
          type: "osidraw",
          version: 1,
          source: "e2e",
          elements: [
            {
              id,
              type: "rectangle",
              x: world.x,
              y: world.y,
              width: 100,
              height: 70,
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
            },
          ],
        }),
      );
      (engine as unknown as SelectHandle).select([id]);
    },
    { id, at },
  );
}

/** The one element in `after` that was not in `before`. */
function onlyNewOf(before: SceneElement[], after: SceneElement[], type: string): SceneElement {
  const beforeIds = new Set(before.map((element) => element.id));
  const found = after.filter((element) => !beforeIds.has(element.id) && element.type === type);
  if (found.length !== 1) {
    throw new Error(`expected exactly one new ${type}, found ${found.length}`);
  }
  return found[0]!;
}

test("Ctrl+Arrow builds a node, release commits, Alt+Arrow walks back", async ({ page }) => {
  const board = await openBoard(page);
  const startId = "start";
  // Focus before selecting: `focusBoard` clicks empty canvas to give the board keyboard
  // focus, and a click on empty canvas in the select tool clears whatever is selected —
  // so the rectangle is placed and selected only once that click is behind it.
  await focusBoard(board);
  await placeStartingRectangle(board, startId, {
    x: OPEN_CANVAS.left + 200,
    y: OPEN_CANVAS.top + 200,
  });

  // Ctrl+Right: previews one node to the right of the selected rectangle. Nothing is in
  // the scene yet — the preview is held outside it until the modifier is released
  // (`ci_flowchart.rs::pending_not_in_scene_before_commit`).
  const beforeFirst = await sceneElements(page);
  await page.keyboard.down("Control");
  await page.keyboard.press("ArrowRight");
  expect(await sceneElements(page), "pending, not yet committed").toHaveLength(beforeFirst.length);
  await page.keyboard.up("Control");

  const afterFirst = await sceneElements(page);
  expect(afterFirst).toHaveLength(beforeFirst.length + 2); // the node and its arrow
  const nodeB = onlyNewOf(beforeFirst, afterFirst, "rectangle");
  const arrowAB = onlyNewOf(beforeFirst, afterFirst, "arrow");
  expect(arrowAB.startBinding).toBe(startId);
  expect(arrowAB.endBinding).toBe(nodeB.id);
  expect(nodeB.x, "placed to the right of the source").toBeGreaterThan(
    afterFirst.find((element) => element.id === startId)!.x,
  );
  expect(await selection(page), "the new node is selected").toEqual([nodeB.id]);

  // Enter starts typing in the node the commit just selected — the same key the plain
  // editor already binds (`keys.ts` › `handlePlainKeys`), reused rather than reinvented.
  await page.keyboard.press("Enter");
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type("second");
  await page.keyboard.press("Escape");
  await expect(editor(page)).toHaveCount(0);
  const withLabel = await sceneElements(page);
  const labeledB = withLabel.find((element) => element.id === nodeB.id)!;
  const label = withLabel.find((element) => element.id === labeledB.boundTextId);
  expect(label?.text).toBe("second");

  // Ctrl+Down off the new node, then 2 while still held picks diamond instead of the
  // default (the source node's own kind) — the extra the oracle does not have.
  const beforeSecond = await sceneElements(page);
  await page.keyboard.down("Control");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("2");
  await page.keyboard.up("Control");

  const afterSecond = await sceneElements(page);
  const nodeC = onlyNewOf(beforeSecond, afterSecond, "diamond");
  const arrowBC = onlyNewOf(beforeSecond, afterSecond, "arrow");
  expect(arrowBC.startBinding).toBe(nodeB.id);
  expect(arrowBC.endBinding).toBe(nodeC.id);
  expect(nodeC.y, "placed below the node it grew from").toBeGreaterThan(nodeB.y);
  expect(await selection(page)).toEqual([nodeC.id]);

  // Alt+Up walks back to the node above — no reveal call of its own from the host: the
  // engine eases the camera for a navigate the same way it does for a commit.
  await page.keyboard.down("Alt");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.up("Alt");
  expect(await selection(page), "navigated back to the parent node").toEqual([nodeB.id]);

  // One diagram, four elements, built without the mouse. One undo removes exactly the
  // last commit (node + arrow), never touching the first.
  const before3rdUndo = await sceneElements(page);
  await page.keyboard.press("Control+z");
  const afterUndo = await sceneElements(page);
  expect(afterUndo).toHaveLength(before3rdUndo.length - 2);
  expect(afterUndo.some((element) => element.id === nodeC.id)).toBe(false);
  expect(afterUndo.some((element) => element.id === nodeB.id)).toBe(true);
});

test("Escape cancels a pending flowchart without adding anything", async ({ page }) => {
  const board = await openBoard(page);
  await focusBoard(board);
  await placeStartingRectangle(board, "start", {
    x: OPEN_CANVAS.left + 200,
    y: OPEN_CANVAS.top + 200,
  });

  const before = await sceneElements(page);
  await page.keyboard.down("Control");
  await page.keyboard.press("ArrowRight");
  expect(await sceneElements(page)).toHaveLength(before.length);
  await page.keyboard.press("Escape");
  await page.keyboard.up("Control");

  expect(await sceneElements(page), "nothing was added").toHaveLength(before.length);
});

test("a new node lands inside the viewport even off the edge of the screen", async ({ page }) => {
  const board = await openBoard(page);
  const { page: p } = board;
  await focusBoard(board);
  // Placed at the canvas's own right edge, so the node this creates — a further 100px
  // of spacing plus its own width to the right (`HORIZONTAL_OFFSET`) — lands off screen
  // without the reveal.
  await placeStartingRectangle(board, "edge", {
    x: OPEN_CANVAS.right - 40,
    y: OPEN_CANVAS.top + 120,
  });

  const before = await sceneElements(p);
  await p.keyboard.down("Control");
  await p.keyboard.press("ArrowRight");
  await p.keyboard.up("Control");

  const after = await sceneElements(p);
  const nodes = after.filter(
    (element) => !before.some((b) => b.id === element.id) && element.type === "rectangle",
  );
  expect(nodes).toHaveLength(1);
  const created = nodes[0]!;

  // The commit's reveal eases the camera over 300ms (`DrawEngine::reveal`); give it time
  // to finish before reading where it landed.
  await p.waitForTimeout(400);

  // Its screen box should now sit inside the page's own viewport rather than off the
  // edge that placed it.
  const { x, y, scale } = await p.evaluate(() => window.__drawEngine!.camera);
  const viewport = p.viewportSize()!;
  const screenLeft = created.x * scale + x;
  const screenRight = (created.x + created.width) * scale + x;
  const screenTop = created.y * scale + y;
  const screenBottom = (created.y + created.height) * scale + y;
  expect(screenRight, "the revealed node's right edge is on screen").toBeGreaterThan(0);
  expect(screenLeft, "the revealed node's left edge is on screen").toBeLessThan(viewport.width);
  expect(screenBottom, "the revealed node's bottom edge is on screen").toBeGreaterThan(0);
  expect(screenTop, "the revealed node's top edge is on screen").toBeLessThan(viewport.height);
});
