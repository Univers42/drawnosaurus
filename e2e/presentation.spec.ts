import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  activeTool,
  camera,
  openBoard,
  regionInk,
  relay,
  sceneElements,
  wheelAt,
  type Board,
} from "./board.ts";

/**
 * Presentation mode: the board's frames shown one at a time, camera fit, chrome hidden,
 * nothing editable. See `docs/reference/presentation.md` and
 * `apps/web/src/lib/draw-chrome/presentation.ts` for the pure slide/step logic this
 * exercises through a real keyboard and a real camera — `presentation.test.ts` and
 * `camera.test.ts` already pin the arithmetic; this is the half those cannot see: whether
 * a keypress in a real browser reaches it and whether the picture on screen agrees.
 */

const FRAME_W = 300;
const FRAME_H = 200;
/** Three frames in creation order, spaced well apart so their fitted views don't overlap. */
const THREE_FRAMES = [
  { id: "F1", type: "frame", x: 0, y: 0, width: FRAME_W, height: FRAME_H, name: "Frame 1" },
  { id: "F2", type: "frame", x: 500, y: 0, width: FRAME_W, height: FRAME_H, name: "Frame 2" },
  { id: "F3", type: "frame", x: 1000, y: 0, width: FRAME_W, height: FRAME_H, name: "Frame 3" },
  { id: "R1", type: "rectangle", x: 20, y: 20, width: 60, height: 60, frameId: "F1" },
];

const ONE_RECT = [{ id: "R1", type: "rectangle", x: 40, y: 40, width: 120, height: 80 }];

async function load(page: Page, elements: Record<string, unknown>[]): Promise<void> {
  await page.evaluate((elements) => {
    const style = {
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
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

/**
 * The camera `fitCamera` (`camera.ts`) computes — duplicated here rather than imported,
 * the way `bounds.ts` is a deliberate second copy of the engine's geometry: the e2e specs
 * live outside every workspace package and cannot reach into `apps/web/src`. Kept to the
 * same three lines of arithmetic so drift between the two shows up as a failing test
 * rather than a coincidence.
 */
function fitFor(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  viewport: { width: number; height: number },
  padding = 24,
): { x: number; y: number; scale: number } {
  const worldW = Math.max(bounds.maxX - bounds.minX, 1);
  const worldH = Math.max(bounds.maxY - bounds.minY, 1);
  const scale = Math.min(
    (viewport.width - padding * 2) / worldW,
    (viewport.height - padding * 2) / worldH,
  );
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return {
    scale,
    x: viewport.width / 2 - centerX * scale,
    y: viewport.height / 2 - centerY * scale,
  };
}

function frameBounds(frame: (typeof THREE_FRAMES)[number]) {
  return {
    minX: frame.x,
    minY: frame.y,
    maxX: frame.x + frame.width,
    maxY: frame.y + frame.height,
  };
}

async function expectCameraFits(
  board: Board,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
): Promise<void> {
  const want = fitFor(bounds, { width: board.box.width, height: board.box.height });
  const got = await camera(board.page);
  expect(got.scale, "scale").toBeCloseTo(want.scale, 2);
  expect(got.x, "x").toBeCloseTo(want.x, 0);
  expect(got.y, "y").toBeCloseTo(want.y, 0);
}

/** Opens a board with three frames, reduced motion on so every camera move lands at once
 *  rather than mid-animation — the easing itself is `camera.test.ts`'s job, not this file's. */
async function openThreeFrameBoard(page: Page): Promise<Board> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const board = await openBoard(page);
  await load(page, THREE_FRAMES);
  return board;
}

test.describe("presentation", () => {
  test("entering Present hides the chrome and fits frame 1", async ({ page }) => {
    const board = await openThreeFrameBoard(page);

    await expect(page.locator('[aria-label="Canvas header"]')).toBeVisible();
    await expect(page.getByRole("toolbar", { name: "Drawing tools" })).toBeVisible();

    await page.keyboard.press("Control+Shift+p");

    await expect(page.locator('[aria-label="Canvas header"]')).toBeHidden();
    await expect(page.getByRole("toolbar", { name: "Drawing tools" })).toBeHidden();
    await expect(page.getByRole("group", { name: "Zoom and history controls" })).toBeHidden();
    await expect(page.getByRole("group", { name: "Presentation controls" })).toBeVisible();
    await expect(page.getByText("1 / 3")).toBeVisible();
    await expectCameraFits(board, frameBounds(THREE_FRAMES[0]!));
  });

  test("the Present menu item opens the same mode", async ({ page }) => {
    const board = await openThreeFrameBoard(page);

    await page.getByRole("button", { name: "Open main menu" }).click();
    await page.getByRole("menuitem", { name: /^Present/ }).click();

    await expect(page.getByRole("group", { name: "Presentation controls" })).toBeVisible();
    await expectCameraFits(board, frameBounds(THREE_FRAMES[0]!));
  });

  test("Next via → and Space, Prev via ←, End then Home, and the counter throughout", async ({
    page,
  }) => {
    const board = await openThreeFrameBoard(page);
    await page.keyboard.press("Control+Shift+p");
    await expect(page.getByText("1 / 3")).toBeVisible();

    await page.keyboard.press("ArrowRight");
    await expect(page.getByText("2 / 3")).toBeVisible();
    await expectCameraFits(board, frameBounds(THREE_FRAMES[1]!));

    await page.keyboard.press(" ");
    await expect(page.getByText("3 / 3")).toBeVisible();
    await expectCameraFits(board, frameBounds(THREE_FRAMES[2]!));

    await page.keyboard.press("ArrowLeft");
    await expect(page.getByText("2 / 3")).toBeVisible();
    await expectCameraFits(board, frameBounds(THREE_FRAMES[1]!));

    await page.keyboard.press("End");
    await expect(page.getByText("3 / 3")).toBeVisible();
    await expectCameraFits(board, frameBounds(THREE_FRAMES[2]!));

    await page.keyboard.press("Home");
    await expect(page.getByText("1 / 3")).toBeVisible();
    await expectCameraFits(board, frameBounds(THREE_FRAMES[0]!));
  });

  test("the Prev/Next/Exit buttons work the same as the keys", async ({ page }) => {
    const board = await openThreeFrameBoard(page);
    await page.keyboard.press("Control+Shift+p");

    await page.getByRole("button", { name: "Next slide" }).click();
    await expect(page.getByText("2 / 3")).toBeVisible();
    await expectCameraFits(board, frameBounds(THREE_FRAMES[1]!));

    await page.getByRole("button", { name: "Previous slide" }).click();
    await expect(page.getByText("1 / 3")).toBeVisible();

    await page.getByRole("button", { name: "Exit presentation" }).click();
    await expect(page.getByRole("group", { name: "Presentation controls" })).toBeHidden();
    await expect(page.locator('[aria-label="Canvas header"]')).toBeVisible();
  });

  test("a drag leaves laser ink on screen and adds no element", async ({ page }) => {
    const board = await openThreeFrameBoard(page);
    const before = await sceneElements(page);
    await page.keyboard.press("Control+Shift+p");
    await expect(page.getByRole("group", { name: "Presentation controls" })).toBeVisible();
    expect(await activeTool(page)).toBe("laser");
    // One repaint before trusting the canvas bitmap — the same settle `openBoard` waits
    // out after its own first mount, here for the camera's jump to frame 1.
    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));

    // Frame 1 is fit to fill most of the screen (see `expectCameraFits`), so the drag —
    // and the probe — stay in its left margin, outside the frame's own rendering, where
    // a fresh region is guaranteed to start out as plain background.
    const y = board.box.height / 2;
    const region = { left: 0, top: y - 40, right: 60, bottom: y + 40 };
    expect(await regionInk(page, region)).toBe(0);

    await page.mouse.move(board.box.x + 15, board.box.y + y);
    await page.mouse.down();
    await page.mouse.move(board.box.x + 45, board.box.y + y, { steps: 6 });

    await expect
      .poll(() => regionInk(page, region), { message: "no laser trail appeared while dragging" })
      .toBeGreaterThan(0.001);

    await page.mouse.up();

    // A gesture, not an edit: nothing was added to the scene.
    expect(await sceneElements(page)).toEqual(before);
  });

  test("Esc exits, restores the camera and the tool, and no other key reaches the board", async ({
    page,
  }) => {
    await openThreeFrameBoard(page);
    const cameraBefore = await camera(page);
    const toolBefore = await activeTool(page);
    const elementsBefore = await sceneElements(page);

    await page.keyboard.press("Control+Shift+p");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByText("2 / 3")).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.getByRole("group", { name: "Presentation controls" })).toBeHidden();
    expect(await activeTool(page)).toBe(toolBefore);
    const cameraAfter = await camera(page);
    expect(cameraAfter.scale).toBeCloseTo(cameraBefore.scale, 5);
    expect(cameraAfter.x).toBeCloseTo(cameraBefore.x, 5);
    expect(cameraAfter.y).toBeCloseTo(cameraBefore.y, 5);
    // Nothing was drawn while presenting, either.
    expect(await sceneElements(page)).toEqual(elementsBefore);
  });

  test("a board with no frames presents as a single slide fit to everything on it", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const board = await openBoard(page);
    await load(page, ONE_RECT);

    await page.keyboard.press("Control+Shift+p");

    await expect(page.getByText("1 / 1")).toBeVisible();
    await expectCameraFits(board, { minX: 40, minY: 40, maxX: 160, maxY: 120 });

    // One slide: Next and Prev are no-ops, not a wrap.
    await page.keyboard.press("ArrowRight");
    await expect(page.getByText("1 / 1")).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByText("1 / 1")).toBeVisible();
  });
});

async function together(page: Page, browser: Browser) {
  const live = relay();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const host = await openBoard(page, "e2e", { live: live.join });
  await load(page, THREE_FRAMES);
  const hash = new URL(page.url()).hash;
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const colleaguePage = await context.newPage();
  await colleaguePage.emulateMedia({ reducedMotion: "reduce" });
  const thrown: string[] = [];
  colleaguePage.on("pageerror", (error) => thrown.push(error.message));
  const colleague = await openBoard(colleaguePage, "e2e", { live: live.join, hash });
  await load(colleaguePage, THREE_FRAMES);
  const close = async () => {
    expect(thrown, "the colleague's page threw").toEqual([]);
    await context.close();
  };
  return { host, colleague, close };
}

test.describe("presentation — Follow", () => {
  test("a peer sees Follow, tracks the presenter's slide, and a pan of their own lets go", async ({
    page,
    browser,
  }) => {
    const { host, colleague, close } = await together(page, browser);

    await host.page.keyboard.press("Control+Shift+p");

    const notice = colleague.page.getByRole("status");
    await expect(notice).toContainText("is presenting — Follow");
    await notice.getByRole("button", { name: "Follow" }).click();

    await expectCameraFits(colleague, frameBounds(THREE_FRAMES[0]!));

    await host.page.keyboard.press("ArrowRight");
    await expectCameraFits(colleague, frameBounds(THREE_FRAMES[1]!));

    // The follower's own pan lets go — the notice offers Follow again rather than
    // fighting the gesture they just made.
    await wheelAt(
      colleague,
      { x: colleague.box.width / 2, y: colleague.box.height / 2 },
      { y: -50 },
    );
    await expect(notice.getByRole("button", { name: "Follow" })).toBeVisible();

    await host.page.keyboard.press("Escape");
    await expect(colleague.page.getByRole("status")).toBeHidden();

    await close();
  });
});
