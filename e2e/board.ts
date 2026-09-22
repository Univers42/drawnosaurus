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
    };
  }
}

export interface Board {
  page: Page;
  canvas: Locator;
  /** The canvas's position on screen, for aiming the mouse at a point on the board. */
  box: { x: number; y: number; width: number; height: number };
}

/** Navigates to a board with the API stubbed out, and waits for the engine to mount. */
export async function openBoard(page: Page, slug = "e2e"): Promise<Board> {
  // The realtime channel. Left unhandled it fails to connect and reconnects on a timer
  // for the length of the run — background work under every assertion, and pages of proxy
  // errors in the log that look like the failure when something else goes wrong.
  await page.routeWebSocket(/\/live$/, () => {});

  await page.route("**/v1/**", async (route) => {
    const url = route.request().url();
    if (route.request().method() !== "GET") {
      // The autosaver's PATCH. Acknowledged so it never retries — an unacknowledged
      // patch arms a retry timer, which is background work running under every
      // assertion in the file.
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
