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
    };
  }
}

/** As much of an element as these specs look at. */
export interface SceneElement {
  id: string;
  type: string;
  isDeleted?: boolean;
  backgroundColor?: string;
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
