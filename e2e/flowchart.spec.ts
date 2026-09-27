import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  OPEN_CANVAS,
  camera,
  focusBoard,
  openBoard,
  sceneElements,
  selection,
  type Board,
  type SceneElement,
} from "./board.ts";

/**
 * Ctrl/Cmd+Arrow builds a connected node, Alt+Arrow walks the graph — ported from the
 * oracle's `App.flowchart.ts@1118751f`. `ci_flowchart_oracle.rs` holds every position,
 * binding and camera to the oracle's own output; this is the half only a real browser can
 * check: that a genuine keydown/keyup reaches `dispatchKeyDown`/`dispatchKeyUp`
 * (`engine/src/host/keys.ts`) through the DOM, that the preview is actually painted while
 * Ctrl is held and commits as one step on release, that the camera brings what a press
 * reaches into the room the real chrome leaves, and that the digit-key shape choice — an
 * extra the oracle lacks — actually switches what lands.
 *
 * See `docs/reference/flowchart.md`.
 */

const editor = (page: Page) => page.locator("textarea[aria-label='Text editor']");

/** The debug handle's calls these specs make, which `board.ts`'s declaration leaves out. */
interface SelectHandle {
  select(ids: string[]): void;
  pendingFlowchartElements(): SceneElement[];
  panBy(dx: number, dy: number): void;
}

/** The cluster previewed while Ctrl/Cmd is held — not in the scene until released. */
function pendingElements(page: Page): Promise<SceneElement[]> {
  return page.evaluate(() =>
    (window.__drawEngine as unknown as SelectHandle).pendingFlowchartElements(),
  );
}

/** Past the reveal's 300ms ease (`CAMERA_REVEAL_MS`), so the camera is where it lands. */
const settle = (page: Page) => page.waitForTimeout(400);

interface ScreenBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where an element is on the canvas now, canvas-relative. */
async function onScreen(page: Page, element: SceneElement): Promise<ScreenBox> {
  const { x, y, scale } = await page.evaluate(() => window.__drawEngine!.camera);
  return {
    left: element.x * scale + x,
    top: element.y * scale + y,
    right: (element.x + element.width) * scale + x,
    bottom: (element.y + element.height) * scale + y,
  };
}

/**
 * That `box` is on the canvas and under none of the chrome floating over it — the
 * toolbar and the inspector, the surfaces the oracle's reveal keeps clear of.
 */
async function expectInTheOpen(board: Board, box: ScreenBox, what: string): Promise<void> {
  expect(box.left, `${what}: left edge on the canvas`).toBeGreaterThanOrEqual(0);
  expect(box.top, `${what}: top edge on the canvas`).toBeGreaterThanOrEqual(0);
  expect(box.right, `${what}: right edge on the canvas`).toBeLessThanOrEqual(board.box.width);
  expect(box.bottom, `${what}: bottom edge on the canvas`).toBeLessThanOrEqual(board.box.height);
  const chrome = [
    board.page.getByRole("toolbar", { name: "Drawing tools" }),
    board.page.getByRole("complementary", { name: "Style inspector" }),
  ];
  for (const surface of chrome) {
    const rect = await surface.boundingBox();
    if (!rect) continue;
    const left = rect.x - board.box.x;
    const top = rect.y - board.box.y;
    const clear =
      box.right <= left ||
      box.left >= left + rect.width ||
      box.bottom <= top ||
      box.top >= top + rect.height;
    expect(clear, `${what}: clear of ${await surface.getAttribute("aria-label")}`).toBe(true);
  }
}

/** Canvas-relative colour at a point. */
async function colourAt(page: Page, x: number, y: number): Promise<[number, number, number]> {
  return page.evaluate(
    ({ x, y }) => {
      const canvas = document.querySelector("canvas")!;
      const scale = canvas.width / canvas.getBoundingClientRect().width;
      const d = canvas
        .getContext("2d")!
        .getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data;
      return [d[0]!, d[1]!, d[2]!] as [number, number, number];
    },
    { x, y },
  );
}

const distance = (a: number[], b: number[]) =>
  a.reduce((sum, v, i) => sum + Math.abs(v - b[i]!), 0);

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
  // The preview is revealed as it is, Ctrl still held — not only once committed.
  await settle(p);
  const [previewed] = (await pendingElements(p)).filter((element) => element.type === "rectangle");
  await expectInTheOpen(board, await onScreen(p, previewed!), "the previewed node");
  await p.keyboard.up("Control");

  const after = await sceneElements(p);
  const nodes = after.filter(
    (element) => !before.some((b) => b.id === element.id) && element.type === "rectangle",
  );
  expect(nodes).toHaveLength(1);
  const created = nodes[0]!;

  // The commit's reveal eases the camera over 300ms (`DrawEngine::reveal_if_hidden`);
  // give it time to finish before reading where it landed.
  await settle(p);
  await expectInTheOpen(board, await onScreen(p, created), "the committed node");

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

test("the shape strip swaps the pending node's shape by click, and letting go of Ctrl still commits", async ({
  page,
}) => {
  const board = await openBoard(page);
  await focusBoard(board);
  await placeStartingRectangle(board, "start", {
    x: OPEN_CANVAS.left + 200,
    y: OPEN_CANVAS.top + 200,
  });
  const before = await sceneElements(page);

  await page.keyboard.down("Control");
  await page.keyboard.press("ArrowRight");
  const strip = page.getByRole("toolbar", { name: "Flowchart node shape" });
  await expect(strip).toBeVisible();
  await strip.getByRole("button", { name: "Diamond (2)" }).click();
  // The click must leave the board's keyboard focus where it was: the release that
  // commits is read by the board's own key listener.
  await page.keyboard.up("Control");

  await expect(strip).toBeHidden();
  const after = await sceneElements(page);
  expect(after, "the node and its arrow committed").toHaveLength(before.length + 2);
  onlyNewOf(before, after, "diamond");
});

// The strip hangs above the node being created, at that node's **top** edge. A start node
// whose own width and height are negative — a resize drag that crossed the anchor leaves it
// so, and the pending nodes copy the start node's extents verbatim
// (`flowchart.rs:356-357`) — used to put the strip a whole node-height too low, on top of
// the preview instead of above it. `camera.test.ts` pins the maths;
// `docs/reference/camera.md`.
test("the shape strip sits above a mirrored pending node, not on it", async ({
  page,
}, testInfo) => {
  const board = await openBoard(page);
  await focusBoard(board);
  await page.evaluate(() => {
    const engine = window.__drawEngine!;
    engine.loadScene(
      JSON.stringify({
        type: "osidraw",
        version: 1,
        source: "e2e",
        elements: [
          {
            id: "shape",
            type: "rectangle",
            x: 600,
            y: 400,
            width: -160,
            height: -100,
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
    (engine as unknown as SelectHandle).select(["shape"]);
  });

  await page.keyboard.down("Control");
  await page.keyboard.press("ArrowRight");
  const strip = page.getByRole("toolbar", { name: "Flowchart node shape" });
  await expect(strip).toBeVisible();

  // The pending cluster's own top edge, from its two corners rather than `y`, and where the
  // camera puts it on screen. The strip sits above that point (`transform: translate(-50%,
  // calc(-100% - 8px))`, `ShapeStrip.svelte`), so its foot is the edge less its own 8px
  // gap — and nowhere near the cluster's bottom edge, which is what an unnormalised box
  // would have handed it.
  const pending = await pendingElements(page);
  expect(pending.length, "a node and its arrow are pending").toBeGreaterThan(0);
  const top = Math.min(
    ...pending.map((element) => Math.min(element.y, element.y + element.height)),
  );
  const bottom = Math.max(
    ...pending.map((element) => Math.max(element.y, element.y + element.height)),
  );
  const view = await camera(page);
  // `boundingBox()` is in page coordinates and the camera's `y` is canvas-relative, so
  // every edge here carries `board.box.y` — the canvas is at the origin today, and a test
  // that forgets this only passes because of it.
  const screenTop = top * view.scale + view.y + board.box.y;
  const screenBottom = bottom * view.scale + view.y + board.box.y;
  const at = (await strip.boundingBox())!;
  const foot = at.y + at.height;
  expect(foot, "the strip sits above the cluster's top edge").toBeLessThan(screenTop);
  expect(foot, "…right against it, bar its own 8px gap").toBeGreaterThan(screenTop - 16);
  expect(foot, "and nowhere near its bottom edge").toBeLessThan(screenBottom);

  await page.screenshot({ path: testInfo.outputPath("mirrored-strip.png") });
  await page.keyboard.up("Control");
});

test("the preview is painted faded while Ctrl is held, and at full strength once released", async ({
  page,
}) => {
  const board = await openBoard(page);
  await focusBoard(board);
  await placeStartingRectangle(board, "start", {
    x: OPEN_CANVAS.left + 150,
    y: OPEN_CANVAS.top + 150,
  });

  await page.keyboard.down("Control");
  await page.keyboard.press("ArrowRight");
  await settle(page);
  const [node] = (await pendingElements(page)).filter((element) => element.type === "rectangle");
  const box = await onScreen(page, node!);
  const centre = { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
  // Below the node nothing is drawn: the board's own background.
  const background = await colourAt(page, centre.x, box.bottom + 25);
  const preview = await colourAt(page, centre.x, centre.y);
  await page.keyboard.up("Control");
  await settle(page);
  const committed = await colourAt(page, centre.x, centre.y);

  // Painted at a fifth of its opacity, as the oracle paints `pendingFlowchartNodes`
  // (`ELEMENT_READY_TO_ERASE_OPACITY`): there, but far lighter than what lands.
  expect(distance(preview, background), "the preview is painted").toBeGreaterThan(8);
  expect(distance(committed, background), "the node is painted").toBeGreaterThan(40);
  expect(distance(preview, background)).toBeLessThan(distance(committed, background) / 2);
});

test("repeat presses grow the preview by a sibling each, and release commits them all", async ({
  page,
}) => {
  const board = await openBoard(page);
  await focusBoard(board);
  await placeStartingRectangle(board, "start", {
    x: OPEN_CANVAS.left + 150,
    y: OPEN_CANVAS.top + 150,
  });
  const before = await sceneElements(page);
  const start = before.find((element) => element.id === "start")!;

  await page.keyboard.down("Control");
  for (let press = 1; press <= 3; press++) {
    await page.keyboard.press("ArrowRight");
    const nodes = (await pendingElements(page)).filter((element) => element.type === "rectangle");
    expect(nodes, `press ${press}`).toHaveLength(press);
  }
  const pending = await pendingElements(page);
  expect(pending.filter((element) => element.type === "arrow")).toHaveLength(3);
  const nodes = pending.filter((element) => element.type === "rectangle");
  // One column to the right of the start, stacked across the direction of growth.
  expect(new Set(nodes.map((node) => node.x)).size).toBe(1);
  expect(nodes[0]!.x).toBeGreaterThan(start.x + start.width);
  expect(new Set(nodes.map((node) => node.y)).size).toBe(3);
  expect(await sceneElements(page), "nothing lands while Ctrl is held").toHaveLength(before.length);
  await page.keyboard.up("Control");

  const after = await sceneElements(page);
  expect(after).toHaveLength(before.length + 6);
  expect(await selection(page), "the first new node is selected").toEqual([nodes[0]!.id]);
});

test("each new node is linked by an elbow arrow, square from side to side", async ({ page }) => {
  const board = await openBoard(page);
  await focusBoard(board);
  await placeStartingRectangle(board, "start", {
    x: OPEN_CANVAS.left + 150,
    y: OPEN_CANVAS.top + 150,
  });
  const before = await sceneElements(page);

  // Three siblings: the middle one straight across, the outer two turning to reach it.
  await page.keyboard.down("Control");
  for (let press = 1; press <= 3; press++) await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Control");

  const arrows = (await sceneElements(page)).filter(
    (element) => element.type === "arrow" && !before.some((old) => old.id === element.id),
  );
  expect(arrows).toHaveLength(3);
  for (const arrow of arrows) {
    expect(arrow.elbowed, `${arrow.id} is an elbow arrow`).toBe(true);
    const points = arrow.points!;
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1]!, points[i]!];
      const square = Math.abs(a[0] - b[0]) < 1e-6 || Math.abs(a[1] - b[1]) < 1e-6;
      expect(square, `${arrow.id} segment ${i} runs square`).toBe(true);
    }
  }
  expect(
    arrows.filter((arrow) => arrow.points!.length > 2),
    "the outer siblings are reached by turning",
  ).toHaveLength(2);
});

test("a new direction mid-gesture starts the preview over, one node that way", async ({ page }) => {
  const board = await openBoard(page);
  await focusBoard(board);
  await placeStartingRectangle(board, "start", {
    x: OPEN_CANVAS.left + 150,
    y: OPEN_CANVAS.top + 100,
  });
  const before = await sceneElements(page);
  const start = before.find((element) => element.id === "start")!;

  await page.keyboard.down("Control");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  const nodes = (await pendingElements(page)).filter((element) => element.type === "rectangle");
  expect(nodes).toHaveLength(1);
  expect(nodes[0]!.y, "below the start").toBeGreaterThan(start.y + start.height);
  await page.keyboard.up("Control");

  const after = await sceneElements(page);
  expect(after).toHaveLength(before.length + 2);
  const node = onlyNewOf(before, after, "rectangle");
  expect(node.y).toBe(nodes[0]!.y);
});

test("Alt+Arrow cycles the nodes at one level, then walks back up the link", async ({ page }) => {
  const board = await openBoard(page);
  await focusBoard(board);
  await placeStartingRectangle(board, "start", {
    x: OPEN_CANVAS.left + 150,
    y: OPEN_CANVAS.top + 150,
  });
  const before = await sceneElements(page);
  await page.keyboard.down("Control");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Control");
  const children = (await sceneElements(page))
    .filter((element) => element.type === "rectangle" && !before.some((b) => b.id === element.id))
    .map((element) => element.id);
  expect(children).toHaveLength(2);
  await page.evaluate(() => (window.__drawEngine as unknown as SelectHandle).select(["start"]));

  await page.keyboard.down("Alt");
  await page.keyboard.press("ArrowRight");
  const first = (await selection(page))[0]!;
  expect(children).toContain(first);
  await page.keyboard.press("ArrowRight");
  const second = (await selection(page))[0]!;
  expect(children).toContain(second);
  expect(second, "a repeat press moves to the sibling").not.toBe(first);
  await page.keyboard.press("ArrowRight");
  expect(await selection(page), "and round again").toEqual([first]);
  await page.keyboard.press("ArrowLeft");
  expect(await selection(page), "back along the link").toEqual(["start"]);
  await page.keyboard.up("Alt");
});

test("Alt+Arrow to a node off screen brings it into the open, zooming back in to 100%", async ({
  page,
}) => {
  const board = await openBoard(page);
  await focusBoard(board);
  await placeStartingRectangle(board, "start", {
    x: OPEN_CANVAS.left + 150,
    y: OPEN_CANVAS.top + 150,
  });
  const before = await sceneElements(page);
  await page.keyboard.down("Control");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Control");
  await settle(page);
  const next = onlyNewOf(before, await sceneElements(page), "rectangle");

  // Zoomed out to half, and scrolled until the new node hangs off the right edge.
  await page.evaluate(
    ({ next, width }) => {
      const engine = window.__drawEngine as unknown as SelectHandle &
        NonNullable<Window["__drawEngine"]>;
      engine.zoomAt(0, 0, 0.5);
      const { x, scale } = engine.camera;
      engine.panBy(width - 20 - (next.x * scale + x), 0);
      engine.select(["start"]);
    },
    { next, width: board.box.width },
  );
  expect((await onScreen(page, next)).right).toBeGreaterThan(board.box.width);

  await page.keyboard.down("Alt");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Alt");
  expect(await selection(page)).toEqual([next.id]);
  await settle(page);

  // A `scale-down` fit: never past 100%, so a small node is shown at 100% — zoomed in.
  expect((await page.evaluate(() => window.__drawEngine!.camera)).scale).toBe(1);
  await expectInTheOpen(board, await onScreen(page, next), "the node walked to");
});
