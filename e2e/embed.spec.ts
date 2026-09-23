import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { OPEN_CANVAS, openBoard, sceneElements, selection, type Board } from "./board.ts";

/**
 * Live pages on the board: loaded so they play, and movable like any other shape.
 *
 * Reported as "the embedded video from YouTube does not work at all — error 153 — and it
 * cannot be moved around or resized". Two causes, each pinned here and each run red
 * against the old code:
 *
 * - every frame was loaded with `referrerpolicy="no-referrer"`, and YouTube refuses to
 *   play for a page that does not say which site it is: "Error 153 — video player
 *   configuration error", on every video;
 * - every frame took every pointer event, so a press on an embed went to the page inside
 *   and never reached the board: it could not be selected, moved or resized from anywhere
 *   it covered. Now the board keeps the pointer and a click in the middle hands it over.
 *
 * No spec reaches the network. Every provider is answered by `FAKE_PLAYER`, which counts
 * the presses that reach it — the direct answer to "did the page take the pointer".
 * `tools/embed-check` loads the real providers, and is kept out of this suite on purpose.
 */

const FAKE_PLAYER = `<!doctype html><html><body style="margin:0;height:100vh;background:#223">
<output id="presses">0</output><output id="message"></output>
<script>
  let presses = 0;
  addEventListener("pointerdown", () => {
    presses += 1;
    document.getElementById("presses").textContent = String(presses);
  });
  addEventListener("message", (event) => {
    document.getElementById("message").textContent = String(event.data);
  });
</script></body></html>`;

/** The live page. Named rather than found through its box, so a change of markup around it cannot hide it. */
const IFRAME = 'iframe[title="Embedded page"]';

const PROVIDERS =
  /^https:\/\/(www\.youtube\.com|player\.vimeo\.com|platform\.twitter\.com|player\.twitch\.tv)\//;

/** Referrers each provider was loaded with, by host. */
async function stubProviders(page: Page): Promise<Map<string, string | undefined>> {
  const referrers = new Map<string, string | undefined>();
  await page.route(PROVIDERS, async (route) => {
    const request = route.request();
    referrers.set(new URL(request.url()).host, request.headers()["referer"]);
    await route.fulfill({ status: 200, contentType: "text/html", body: FAKE_PLAYER });
  });
  await page.route(/^https:\/\/gist\.github\.com\/.*\.js$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `document.write('<div class="gist" id="gist">a gist</div>');`,
    }),
  );
  return referrers;
}

/** The middle of the open canvas, canvas-relative. */
const MIDDLE = {
  x: (OPEN_CANVAS.left + OPEN_CANVAS.right) / 2,
  y: (OPEN_CANVAS.top + OPEN_CANVAS.bottom) / 2,
};

interface Frame {
  id: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

/** Puts an embed in the middle of the board through the engine, as the dialog does. */
async function insert(board: Board, url: string): Promise<Frame> {
  const id = await board.page.evaluate(
    ({ url, at }) => window.__drawEngine!.insertEmbed(url, at.x, at.y),
    { url, at: MIDDLE },
  );
  expect(id, `${url} was refused`).not.toBeNull();
  await expect(board.page.locator(IFRAME)).toHaveCount(1);
  return frameOf(board, id!);
}

/** Where the engine says the embed's frame is, canvas-relative screen pixels. */
async function frameOf(board: Board, id: string): Promise<Frame> {
  const frames = await board.page.evaluate(
    () => JSON.parse(window.__drawEngine!.embedFramesJson()) as Frame[],
  );
  const frame = frames.find((f) => f.id === id);
  if (!frame) throw new Error(`no frame for ${id}`);
  return frame;
}

/** The frame's box on the page, canvas-relative. */
async function shownBox(board: Board) {
  const box = await board.page.locator(".embed-frame").boundingBox();
  if (!box) throw new Error("the frame is not on the page");
  return { x: box.x - board.box.x, y: box.y - board.box.y, width: box.width, height: box.height };
}

function presses(page: Page): Promise<string> {
  return page.frameLocator(IFRAME).locator("#presses").innerText();
}

async function drag(board: Board, from: { x: number; y: number }, by: { x: number; y: number }) {
  const { page } = board;
  await page.mouse.move(board.box.x + from.x, board.box.y + from.y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(
      board.box.x + from.x + (by.x * step) / 6,
      board.box.y + from.y + (by.y * step) / 6,
    );
  }
  await page.mouse.up();
}

test.describe("loading a live page", () => {
  test("YouTube is told which site is embedding it", async ({ page }) => {
    const referrers = await stubProviders(page);
    const board = await openBoard(page);
    await insert(board, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");

    const iframe = page.locator(IFRAME);
    await expect(iframe).toHaveAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    await expect(iframe).toHaveAttribute(
      "src",
      "https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1",
    );
    await expect.poll(() => referrers.has("www.youtube.com")).toBe(true);
    // The origin, and nothing of the board's own address.
    const origin = new URL(page.url()).origin;
    expect(referrers.get("www.youtube.com"), "loaded with no referrer: Error 153").toBe(
      `${origin}/`,
    );
  });

  test("Twitch is told which site is embedding it", async ({ page }) => {
    await stubProviders(page);
    const board = await openBoard(page);
    await insert(board, "https://www.twitch.tv/monstercat");

    const src = await page.locator(IFRAME).getAttribute("src");
    expect(new URL(src!).searchParams.get("parent")).toBe(new URL(page.url()).hostname);
  });

  test("a gist runs in a document of its own, with no origin", async ({ page }) => {
    // GitHub offers a gist only as a script that writes itself into the page running it.
    // The frame is a small document that runs it — and a document we frame would have
    // *our* origin, so it gets none.
    await stubProviders(page);
    const board = await openBoard(page);
    await insert(board, "https://gist.github.com/octocat/6cad326836d38bd3a7ae");

    const iframe = page.locator(IFRAME);
    await expect(iframe).toHaveAttribute(
      "srcdoc",
      /gist\.github\.com\/octocat\/6cad326836d38bd3a7ae\.js/,
    );
    expect(await iframe.getAttribute("sandbox")).not.toContain("allow-same-origin");
    await expect(page.frameLocator(IFRAME).locator("#gist")).toHaveText("a gist");
  });

  test("a board saved with a tweet at its own page gets the address that frames", async ({
    page,
  }) => {
    // Twitter refuses to be framed at the tweet's page. The frame is resolved again each
    // time it is shown, so a board saved that way is fixed by opening it.
    await stubProviders(page);
    const board = await openBoard(page);
    await insert(board, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    // The same board as it would have been saved under the old rules.
    const loaded = await page.evaluate(() => {
      const engine = window.__drawEngine!;
      const saved = engine
        .exportJson()
        .replace(
          "https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1",
          "https://twitter.com/jack/status/20",
        );
      return engine.loadScene(saved);
    });
    expect(loaded).toBe(true);
    await expect(page.locator(IFRAME)).toHaveAttribute(
      "src",
      "https://platform.twitter.com/embed/Tweet.html?id=20&dnt=true",
    );
  });
});

test.describe("an embed on the board", () => {
  test("is moved by dragging it, and the page inside never gets the press", async ({ page }) => {
    await stubProviders(page);
    const board = await openBoard(page);
    const before = await insert(board, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    const id = before.id;

    const from = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
    await drag(board, from, { x: 120, y: 60 });

    const after = await frameOf(board, id);
    expect(after.x - before.x).toBeCloseTo(120, 0);
    expect(after.y - before.y).toBeCloseTo(60, 0);
    const shown = await shownBox(board);
    expect(shown.x).toBeCloseTo(after.x, 0);
    expect(shown.y).toBeCloseTo(after.y, 0);
    expect(await presses(page), "the press went to the page instead of the board").toBe("0");
  });

  test("keeps up with the embed while it is being dragged", async ({ page }) => {
    // Not only once it is let go: a frame that stays behind for the length of a drag
    // looks like the page has come loose from the board.
    await stubProviders(page);
    const board = await openBoard(page);
    const before = await insert(board, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");

    const from = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
    await page.mouse.move(board.box.x + from.x, board.box.y + from.y);
    await page.mouse.down();
    for (let step = 1; step <= 5; step += 1) {
      await page.mouse.move(board.box.x + from.x + step * 20, board.box.y + from.y);
    }
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)));
    const midway = await frameOf(board, before.id);
    expect(midway.x - before.x, "the element did not move").toBeCloseTo(100, 0);
    expect((await shownBox(board)).x).toBeCloseTo(midway.x, 0);
    await page.mouse.up();
  });

  test("is resized by its corner handle, and the page is resized with it", async ({ page }) => {
    await stubProviders(page);
    const board = await openBoard(page);
    const before = await insert(board, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(await selection(page), "an embed arrives selected").toEqual([before.id]);

    // The corner handle sits eight pixels beyond the box, clear of the frame.
    const corner = { x: before.x + before.width + 8, y: before.y + before.height + 8 };
    await drag(board, corner, { x: 80, y: 45 });

    const after = await frameOf(board, before.id);
    expect(after.width).toBeGreaterThan(before.width + 60);
    const shown = await shownBox(board);
    expect(shown.width).toBeCloseTo(after.width, 0);
    expect(shown.height).toBeCloseTo(after.height, 0);
  });

  test("a click in its middle hands the pointer to the page, a press on the board takes it back", async ({
    page,
  }) => {
    await stubProviders(page);
    const board = await openBoard(page);
    const frame = await insert(board, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    const middle = {
      x: board.box.x + frame.x + frame.width / 2,
      y: board.box.y + frame.y + frame.height / 2,
    };

    // Loaded first: a message posted to a page that has not loaded yet reaches nobody.
    await expect(page.frameLocator(IFRAME).locator("#presses")).toHaveText("0");
    await page.mouse.click(middle.x, middle.y);
    await expect(page.locator(".embed-frame")).toHaveClass(/active/);
    // One click both activates a video and plays it.
    await expect(page.frameLocator(IFRAME).locator("#message")).toContainText("playVideo");

    await page.mouse.click(middle.x, middle.y);
    await expect.poll(() => presses(page), "the page did not get the pointer").toBe("1");

    // Anywhere on the board takes it back.
    await page.mouse.click(board.box.x + OPEN_CANVAS.left + 20, board.box.y + OPEN_CANVAS.top + 20);
    await expect(page.locator(".embed-frame")).not.toHaveClass(/active/);
    await page.mouse.click(middle.x, middle.y + 1);
    await page.waitForTimeout(150);
    // That press re-activated it rather than reaching the page: still one.
    expect(await presses(page)).toBe("1");
  });

  test("a click near its edge only selects it", async ({ page }) => {
    // The middle third is the page's; the rest is the board's, so an embed can be picked
    // up without starting the video.
    await stubProviders(page);
    const board = await openBoard(page);
    const frame = await insert(board, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await page.mouse.click(board.box.x + OPEN_CANVAS.left + 20, board.box.y + OPEN_CANVAS.top + 20);
    expect(await selection(page)).toEqual([]);

    await page.mouse.click(
      board.box.x + frame.x + frame.width * 0.12,
      board.box.y + frame.y + frame.height * 0.5,
    );
    expect(await selection(page)).toEqual([frame.id]);
    await expect(page.locator(".embed-frame")).not.toHaveClass(/active/);
  });

  test("is laid out at its size on the board and scaled with the zoom", async ({ page }) => {
    // So the page zooms with the drawing instead of reflowing in a shrinking box — and a
    // player keeps a usable viewport when the board is zoomed out.
    await stubProviders(page);
    const board = await openBoard(page);
    const frame = await insert(board, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    const element = (await sceneElements(page)).find((el) => el.id === frame.id)!;

    await page.evaluate(({ x, y }) => window.__drawEngine!.zoomAt(x, y, 0.4), MIDDLE);
    const zoomed = await frameOf(board, frame.id);
    await expect
      .poll(async () => (await shownBox(board)).width)
      .toBeCloseTo(element.width * zoomed.scale, 0);
    const laidOut = await page
      .locator(IFRAME)
      .evaluate((iframe) => (iframe as HTMLIFrameElement).offsetWidth);
    // Zoomed out past three quarters, a player is laid out at three quarters of its size.
    expect(laidOut).toBeCloseTo(element.width * 0.75, 0);
  });
});
