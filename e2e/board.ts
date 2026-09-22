import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Opening a board in a browser, with nothing behind it.
 *
 * Every `/v1/**` call is stubbed here rather than served, so these specs need no API and
 * no Mongo. That is not only about speed: a suite that talks to a database fails for
 * reasons that belong to the database, and then nobody believes it. The board route
 * already falls back to an empty scene when the fetch fails, so the stubs only make the
 * failure instant and identical every run.
 */

/** The camera the engine holds, as the dev-only handle reports it. */
export interface Camera {
  x: number;
  y: number;
  scale: number;
}

declare global {
  interface Window {
    /** Set by `DrawSurface` under `import.meta.env.DEV`; absent from a production build. */
    __drawEngine?: {
      readonly camera: Camera;
      screenToWorld(sx: number, sy: number): { x: number; y: number };
      zoomAt(sx: number, sy: number, factor: number): void;
      exportJson(): string;
      getTool(): string;
      getSelection(): string[];
      getGrid(): { enabled: boolean; size: number; step: number; snap: boolean };
      setGrid(grid: { enabled?: boolean }): void;
      /** Replaces the whole scene — used to place geometry too small to draw by hand. */
      loadScene(json: string): void;
    };
  }
}

/** As much of an element as these specs look at. */
export interface SceneElement {
  id: string;
  type: string;
  isDeleted?: boolean;
  backgroundColor?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Point-based kinds only — a line, an arrow or a freehand stroke. */
  points?: [number, number][];
}

/** Every `PATCH /v1/**` body the page has sent, in order, per page. */
const patches = new WeakMap<Page, SceneElement[][]>();

export interface Board {
  page: Page;
  canvas: Locator;
  /** The canvas's position on screen, for aiming the mouse at a point on the board. */
  box: { x: number; y: number; width: number; height: number };
}

/**
 * A region of the canvas with none of the chrome floating over it.
 *
 * The toolbar, the inspector and the zoom bar are absolutely positioned *on top of* the
 * canvas rather than beside it, so a gesture that starts under one of them is swallowed
 * by a panel and never reaches the engine — with no error, no console warning and an
 * empty scene at the end. Anything that draws starts inside this. Canvas-relative, at the
 * 1280×800 viewport the config pins.
 */
export const OPEN_CANVAS = { left: 440, top: 170, right: 1160, bottom: 650 } as const;

/** Navigates to a board with the API stubbed out, and waits for the engine to mount. */
export async function openBoard(page: Page, slug = "e2e"): Promise<Board> {
  // The realtime channel. Left unhandled it fails to connect and reconnects on a timer
  // for the length of the run — background work under every assertion, and pages of proxy
  // errors in the log that look like the failure when something else goes wrong.
  await page.routeWebSocket(/\/live$/, () => {});

  patches.set(page, []);

  await page.route("**/v1/**", async (route) => {
    const url = route.request().url();
    if (route.request().method() !== "GET") {
      // The autosaver's PATCH: recorded, then acknowledged. Recorded because "did this
      // reach the server" is a question the engine cannot answer about itself, and it is
      // where the bucket fill's own bug lived. Acknowledged because an unacknowledged
      // patch arms a retry timer, which is background work under every later assertion.
      const body = route.request().postDataJSON() as { elements?: SceneElement[] } | null;
      patches.get(page)?.push(body?.elements ?? []);
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return;
    }
    if (url.includes("/boards/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          slug,
          title: "E2E",
          scene: { type: "osidraw", version: 1, source: "e2e", elements: [] },
        }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto(`/boards/${slug}`);

  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();
  // The engine is WASM fetched and instantiated after hydration; until the handle is
  // there, a wheel event would land on a canvas with no listener and silently do nothing.
  await page.waitForFunction(() => window.__drawEngine !== undefined);

  // The handle appears as soon as the engine is constructed, which is earlier than the
  // app is settled: the board route is still finishing its fetch, the autosaver is still
  // arming, and Svelte may still have work queued. A gesture that starts inside that
  // window has been seen to reach a canvas that is about to be re-rendered, and it lands
  // nowhere — the tool stays selected and no element is created. Waiting for the network
  // to go quiet and for one frame to pass closes it.
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));

  const box = await canvas.boundingBox();
  if (!box) throw new Error("the canvas has no box to aim at");
  return { page, canvas, box };
}

/** The camera as the engine holds it — full precision, not the toolbar's rounded percent. */
export function camera(page: Page): Promise<Camera> {
  return page.evaluate(() => {
    const engine = window.__drawEngine;
    if (!engine) throw new Error("no engine");
    const { x, y, scale } = engine.camera;
    return { x, y, scale };
  });
}

/** The zoom percentage the toolbar shows, read from its accessible name. */
export async function shownZoomPercent(page: Page): Promise<number> {
  const label = await page
    .getByRole("button", { name: /^Zoom \d+ percent/ })
    .getAttribute("aria-label");
  const match = /^Zoom (\d+) percent/.exec(label ?? "");
  if (!match) throw new Error(`the zoom readout is missing: ${label}`);
  return Number(match[1]);
}

/**
 * One wheel event at a point on the board.
 *
 * Real input through CDP rather than a synthesised `WheelEvent`, so the modifier state,
 * the target and the coalescing are the browser's rather than ours — and `deltaMode` is
 * pixels, which is what makes the numbers here mean the same thing on every machine.
 */
export async function wheelAt(
  board: Board,
  at: { x: number; y: number },
  delta: { x?: number; y?: number },
  modifiers: { ctrl?: boolean; shift?: boolean } = {},
): Promise<void> {
  const { page, box } = board;
  await page.mouse.move(box.x + at.x, box.y + at.y);
  if (modifiers.ctrl) await page.keyboard.down("Control");
  if (modifiers.shift) await page.keyboard.down("Shift");
  await page.mouse.wheel(delta.x ?? 0, delta.y ?? 0);
  if (modifiers.shift) await page.keyboard.up("Shift");
  if (modifiers.ctrl) await page.keyboard.up("Control");
}

/** How far apart two scales are, as a ratio ≥ 1 whichever way the zoom went. */
export function stepRatio(before: number, after: number): number {
  return after > before ? after / before : before / after;
}

/** `WheelEvent.deltaMode`: the unit `deltaY` is counted in. */
export const DELTA_PIXEL = 0;
export const DELTA_LINE = 1;
export const DELTA_PAGE = 2;

/**
 * One wheel event with an explicit `deltaMode`, dispatched rather than driven.
 *
 * The one exception to this file's rule that input is real, and it is forced.
 * `deltaMode` says which unit `deltaY` is counted in, and Chromium only ever reports
 * PIXEL: the unit is decided by the platform's wheel handling long before the page, so
 * no CDP call, device emulation or flag makes it send LINE. Firefox reports LINE for a
 * mouse wheel on Windows and Linux, so the unit the handler must cope with is one the
 * browser this suite runs cannot produce.
 *
 * A dispatched event still exercises the real branch — the listener reads `deltaMode`
 * off the event it is handed, and does not check `isTrusted`. What it cannot prove is
 * that Firefox sends what it is documented to send; closing that needs a Firefox
 * project, which costs a second browser download in CI.
 */
export async function dispatchWheelAt(
  board: Board,
  at: { x: number; y: number },
  delta: { x?: number; y?: number; mode: number },
  modifiers: { ctrl?: boolean; shift?: boolean } = {},
): Promise<void> {
  const { page, box } = board;
  await page.evaluate(
    ({ at, delta, modifiers, box }) => {
      const canvas = document.querySelector("canvas");
      if (!canvas) throw new Error("no canvas to dispatch on");
      canvas.dispatchEvent(
        new WheelEvent("wheel", {
          deltaX: delta.x ?? 0,
          deltaY: delta.y ?? 0,
          deltaMode: delta.mode,
          ctrlKey: modifiers.ctrl ?? false,
          shiftKey: modifiers.shift ?? false,
          clientX: box.x + at.x,
          clientY: box.y + at.y,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { at, delta, modifiers, box },
  );
}

/**
 * How much of the canvas is not the flat background colour, as a fraction of its pixels.
 *
 * `layer.spec.ts` compares whole frames for equality, which is the sharper test when both
 * frames exist. This answers a blunter question that equality cannot: is there anything
 * on the board at all. A layer bug that blits an empty canvas over the screen leaves a
 * frame that is perfectly self-consistent and completely blank, and the number that
 * catches it is this one going to zero.
 *
 * The background is sampled from the top-left pixel rather than assumed, so it holds in
 * either theme. The tolerance of 12 per channel ignores the grid, which is a few per cent
 * off the background and would otherwise read as content.
 */
export function canvasInk(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) throw new Error("no canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const background = [data[0]!, data[1]!, data[2]!];
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (
        Math.abs(data[i]! - background[0]!) > 12 ||
        Math.abs(data[i + 1]! - background[1]!) > 12 ||
        Math.abs(data[i + 2]! - background[2]!) > 12
      ) {
        ink += 1;
      }
    }
    return ink / (width * height);
  });
}

/** Puts the camera back at 100% and the origin, so a step can be measured from a known place. */
export async function resetCamera(page: Page): Promise<void> {
  await page.evaluate(() => {
    const engine = window.__drawEngine!;
    engine.zoomAt(0, 0, 1 / engine.camera.scale);
  });
}

/**
 * Chooses a tool by its label on the toolbar, opening the more-tools menu when it lives
 * there.
 *
 * Through the toolbar rather than the hotkey, because the keyboard listener is on the
 * focused container and a spec that has clicked elsewhere would silently select nothing —
 * and a spec that silently draws with the wrong tool fails somewhere far from the cause.
 */
export async function pickTool(page: Page, label: string): Promise<void> {
  const onTheBar = page.getByRole("button", { name: new RegExp(`^${label} \\(`) });
  if ((await onTheBar.count()) > 0) {
    await onTheBar.first().click();
    return;
  }
  await page.getByRole("button", { name: /^More tools/ }).click();
  await page.getByRole("menuitemradio", { name: label, exact: false }).click();
}

/**
 * Puts keyboard focus on the board.
 *
 * The engine's key listener is on the editor container, not the window, so that a page
 * embedding the canvas keeps its own shortcuts. Nothing has focused it until something is
 * clicked, so a spec that starts by pressing a key presses it into the void.
 */
export async function focusBoard(board: Board): Promise<void> {
  const { page, box } = board;
  await page.mouse.click(box.x + OPEN_CANVAS.right - 20, box.y + OPEN_CANVAS.bottom - 20);
}

/**
 * Clicks the nth element, wherever the camera has put it.
 *
 * Two traps, both of which produce an empty selection and no clue why:
 *
 * - aiming at the coordinates a shape was *drawn* at only works while the camera has not
 *   moved, so any spec that zooms or pans first misses;
 * - a shape with a transparent background — the default — is hit on its *outline* only,
 *   so the middle of a rectangle is not on it. The top edge is.
 */
export async function clickElement(board: Board, index: number): Promise<void> {
  const at = await board.page.evaluate((which) => {
    const engine = window.__drawEngine!;
    const element = JSON.parse(engine.exportJson()).elements[which];
    const { x, y, scale } = engine.camera;
    return {
      x: (element.x + element.width / 2) * scale + x,
      y: element.y * scale + y,
    };
  }, index);
  await board.page.mouse.click(board.box.x + at.x, board.box.y + at.y);
}

/** The tool the engine currently has active. */
export function activeTool(page: Page): Promise<string> {
  return page.evaluate(() => window.__drawEngine!.getTool());
}

/** The ids the engine currently has selected. */
export function selection(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__drawEngine!.getSelection());
}

/** The elements the engine currently holds, deleted ones excluded. */
export async function sceneElements(page: Page): Promise<SceneElement[]> {
  const json = await page.evaluate(() => window.__drawEngine!.exportJson());
  const file = JSON.parse(json) as { elements?: SceneElement[] };
  return (file.elements ?? []).filter((element) => !element.isDeleted);
}

/** Their types, in scene order — which is z-order, back to front. */
export async function elementKinds(page: Page): Promise<string[]> {
  return (await sceneElements(page)).map((element) => element.type);
}

/** Every element the page has sent to the API so far, flattened across patches. */
export async function patchedElements(page: Page): Promise<SceneElement[]> {
  // `await` so callers read the same whether or not this ever needs to reach the page.
  await Promise.resolve();
  return (patches.get(page) ?? []).flat();
}
