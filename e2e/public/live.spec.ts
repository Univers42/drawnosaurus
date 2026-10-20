import { expect, test } from "../fixtures.ts";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { listenForPicker, pickTool, relay, sceneElements, type SceneElement } from "../board.ts";
import { drawingReady, openApp } from "./drawing.ts";

/**
 * Sharing, live, in the public build: the spec's scenarios 3 and 4.
 *
 * A drawing is shared, and two people draw on it together. The relay drops a publish
 * over 64 KiB, as the Rust relay and the Worker both do, so a drawing bigger than that
 * never arrives over the live link: the online copy is the only way to it, and the
 * sharer writes the copy when a peer joins.
 */

type Live = ReturnType<typeof relay>;

/** The style every element of a loaded scene carries. */
const STYLE = {
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

/** `count` rectangles, spread over the board, from `from` on. */
function rectangles(count: number, from = 0): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `e${from + i}`,
    type: "rectangle",
    x: (i % 40) * 60,
    y: Math.floor(i / 40) * 60,
    width: 50,
    height: 40,
  }));
}

/** The scene, loaded into the engine the way the app's own code loads one. */
async function load(page: Page, elements: Record<string, unknown>[]): Promise<void> {
  await page.evaluate(
    ({ elements, style }) => {
      const placed = elements.map((element) => ({ ...style, ...element }));
      window.__drawEngine!.loadScene(
        JSON.stringify({ type: "osidraw", version: 1, source: "e2e", elements: placed }),
      );
    },
    { elements, style: STYLE },
  );
}

/** The Share dialog's link: the drawing's address and its secret. */
async function share(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Share & collaborate" }).click();
  await page.getByRole("button", { name: "Share live" }).click();
  const link = page.getByLabel("Share link");
  await expect(link).toBeVisible();
  const url = await link.inputValue();
  // The dialog is closed again: the board is what the rest of the test is about.
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  return url;
}

/** A second person, in a browser of their own, opening the link. */
async function openLink(
  browser: Browser,
  link: string,
  live: Live,
): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const thrown: string[] = [];
  page.on("pageerror", (error) => thrown.push(error.message));
  await page.routeWebSocket(/\/ws$/, live.join);
  await page.goto(link);
  await drawingReady(page);
  expect(thrown, "the newcomer's page threw").toEqual([]);
  return { page, context };
}

/** The number of elements on the board. */
const count = async (page: Page): Promise<number> => (await sceneElements(page)).length;

test("a second browser opens the share link and sees the drawing, live, both ways", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const live = relay({ payloadCap: 64 * 1024 });
  await page.routeWebSocket(/\/ws$/, live.join);
  await openApp(page);

  // A drawing bigger than the relay's payload: a live sync that big never arrives.
  await load(page, rectangles(300));
  await expect.poll(() => count(page)).toBe(300);
  const link = await share(page);

  // More of the drawing, after the share: the online copy is written every twenty
  // seconds, so this is not in it yet — and it is too big for the relay to carry.
  await load(page, rectangles(600));
  await expect.poll(() => count(page)).toBe(600);
  const size = await page.evaluate(() => window.__drawEngine!.exportJson().length);
  expect(size, "the drawing is over the relay's payload cap").toBeGreaterThan(64 * 1024);

  const other = await openLink(browser, link, live);
  const theirs = other.page;

  // The newcomer finds the drawing in the online copy, and the sharer's pending edits
  // in it too: the sharer writes them when a peer joins, and the newcomer reads the
  // copy. The live sync could not have carried them — it is over the cap.
  await expect
    .poll(() => count(theirs), { timeout: 30_000, message: "the newcomer never saw the drawing" })
    .toBe(600);

  // Live, both ways: what one of them draws, the other sees.
  await drawRectangleAt(theirs, 700, 700);
  await expect.poll(() => count(page)).toBe(601);
  await drawRectangleAt(page, 800, 800);
  await expect.poll(() => count(theirs)).toBe(601);

  await other.context.close();
});

/** A rectangle, drawn at a point of the board. */
async function drawRectangleAt(page: Page, x: number, y: number): Promise<void> {
  const box = await page.locator("canvas").first().boundingBox();
  if (!box) throw new Error("the canvas has no box to aim at");
  await pickTool(page, "Rectangle");
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + 80, box.y + y + 60, { steps: 4 });
  await page.mouse.up();
}

test("with the sharer's page closed, a third browser opens the link and gets the drawing", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const live = relay();
  await page.routeWebSocket(/\/ws$/, live.join);
  const { board } = await openApp(page);

  // A picture of canvas noise, near the app's own limit of four megabytes.
  const noise = await noisePng(page);
  expect(noise.byteLength, "the picture is not the size it should be").toBeGreaterThan(
    3 * 1024 * 1024,
  );
  const listening = await listenForPicker(page);
  await pickTool(page, "Insert image");
  await (
    await listening.opened
  ).setFiles({
    name: "noise.png",
    mimeType: "image/png",
    buffer: noise,
  });
  await expect
    .poll(async () => (await sceneElements(page)).filter((e) => e.type === "image").length)
    .toBe(1);

  const link = await share(page);
  // The sharer is gone: their page is closed, and the copy is all that is left.
  await page.close();

  const other = await openLink(browser, link, live);
  const elements = await sceneElements(other.page);
  expect(elements.length, "the drawing did not come with the link").toBe(1);
  const image = elements.find((element) => element.type === "image") as
    (SceneElement & { dataUrl?: string }) | undefined;
  expect(image?.dataUrl, "the picture did not come with the drawing").toBeDefined();
  expect(image?.dataUrl?.startsWith("data:image/")).toBe(true);
  expect(image?.dataUrl?.length ?? 0, "the picture is not the size it should be").toBeGreaterThan(
    3 * 1024 * 1024,
  );

  await other.context.close();
  expect(board.page.isClosed()).toBe(true);
});

/** A PNG of canvas noise, near the app's own limit of four megabytes. */
async function noisePng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 980;
    canvas.height = 980;
    const ctx = canvas.getContext("2d")!;
    const image = ctx.createImageData(canvas.width, canvas.height);
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = Math.floor(Math.random() * 256);
      image.data[i + 1] = Math.floor(Math.random() * 256);
      image.data[i + 2] = Math.floor(Math.random() * 256);
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  return Buffer.from(base64, "base64");
}
