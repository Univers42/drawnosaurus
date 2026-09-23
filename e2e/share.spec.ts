import type { Page, WebSocketRoute } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { OPEN_CANVAS, openBoard, pickTool, sceneElements, type Board } from "./board.ts";

/**
 * Drawing together from another computer: the Share dialog's links, and the live link
 * between a page that has Web Crypto and one that has none.
 *
 * Reported as "we need to connect with a URL over the LAN and draw together, and then
 * over the internet". Three things stood in the way, each pinned here:
 *
 * - the dialog offered the page's own address, which on the computer running the stack
 *   is `localhost` — a link to the colleague's own machine;
 * - a colleague opening the board at `http://10.x.x.x` is not in a secure context, so
 *   the browser gives them no `crypto.subtle`, and the live link died importing the room
 *   key — nothing they drew reached anyone, and nothing reached them;
 * - the copy button used `navigator.clipboard`, which is missing there too.
 *
 * The network itself — the gateway, the ports, the tunnel — is outside a browser spec;
 * `docs/collaboration.md` says how it was checked end to end.
 */

async function stubShare(page: Page, answer: { lan: string[]; public: string | null }) {
  // After openBoard's catch-all, so it is asked first.
  await page.route("**/v1/share", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer) }),
  );
}

async function openShare(page: Page) {
  await page.getByRole("button", { name: /share/i }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

const links = (page: Page) =>
  page
    .locator(".link-row input")
    .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));

test.describe("the Share dialog", () => {
  test("offers the network address, never this computer's", async ({ page }) => {
    await openBoard(page);
    await stubShare(page, { lan: ["http://10.12.19.1:5273"], public: null });
    await openShare(page);

    await expect(page.locator('[data-kind="network"] input')).toHaveValue(
      /^http:\/\/10\.12\.19\.1:5273\/boards\/e2e#room=[A-Za-z0-9_-]{43}$/,
    );
    const offered = await links(page);
    expect(
      offered.some((url) => /127\.0\.0\.1|localhost/.test(url)),
      offered.join(),
    ).toBe(false);
    // And how to reach someone outside the network.
    await expect(page.getByText("make share")).toBeVisible();
  });

  test("offers the internet link when the tunnel is up", async ({ page }) => {
    await openBoard(page);
    await stubShare(page, {
      lan: ["http://10.12.19.1:5273"],
      public: "https://keen-lamp-rise.trycloudflare.com",
    });
    await openShare(page);

    await expect(page.locator('[data-kind="internet"] input')).toHaveValue(
      /^https:\/\/keen-lamp-rise\.trycloudflare\.com\/boards\/e2e#room=/,
    );
    await expect(page.locator(".link-row")).toHaveCount(2);
  });

  test("says so when a link would work on this computer only", async ({ page }) => {
    await openBoard(page);
    await stubShare(page, { lan: [], public: null });
    await openShare(page);

    await expect(page.locator('[data-kind="this-computer"]')).toContainText("Only this computer");
    await expect(page.locator('[data-kind="this-computer"]')).toContainText("make up");
  });
});

/** A relay standing in for the API's live route: every frame goes to every other page. */
function relay() {
  const sockets: WebSocketRoute[] = [];
  const frames: string[] = [];
  const join = (socket: WebSocketRoute) => {
    sockets.push(socket);
    socket.onMessage((message) => {
      const text = String(message);
      frames.push(text);
      for (const other of sockets) if (other !== socket) other.send(text);
    });
  };
  return { join, frames };
}

async function drawBox(board: Board, at: { x: number; y: number }) {
  const { page, box } = board;
  await pickTool(page, "Rectangle");
  await page.mouse.move(box.x + at.x, box.y + at.y);
  await page.mouse.down();
  await page.mouse.move(box.x + at.x + 140, box.y + at.y + 90, { steps: 4 });
  await page.mouse.up();
}

test("two people draw together when one of them has no Web Crypto", async ({ page, browser }) => {
  // The colleague on http://10.x.x.x, as the browser sees them: no `crypto.subtle`.
  const live = relay();
  const host = await openBoard(page, "e2e", { live: live.join });
  const hash = new URL(page.url()).hash;
  expect(hash).toMatch(/^#room=/);

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const colleaguePage = await context.newPage();
  const thrown: string[] = [];
  colleaguePage.on("pageerror", (error) => thrown.push(error.message));
  await colleaguePage.addInitScript(() => {
    Object.defineProperty(Crypto.prototype, "subtle", { get: () => undefined });
  });
  const colleague = await openBoard(colleaguePage, "e2e", { live: live.join, hash });
  expect(await colleaguePage.evaluate(() => typeof crypto.subtle)).toBe("undefined");

  await drawBox(host, { x: OPEN_CANVAS.left + 60, y: OPEN_CANVAS.top + 60 });
  await expect
    .poll(async () => (await sceneElements(colleaguePage)).length, {
      message: "the host's box did not reach the colleague",
    })
    .toBe(1);

  await drawBox(colleague, { x: OPEN_CANVAS.left + 360, y: OPEN_CANVAS.top + 200 });
  await expect
    .poll(async () => (await sceneElements(page)).length, {
      message: "the colleague's box did not reach the host",
    })
    .toBe(2);

  // Sealed both ways: the relay — the server, in real life — read nothing.
  expect(live.frames.length).toBeGreaterThan(2);
  for (const frame of live.frames) expect(JSON.parse(frame)).toMatchObject({ v: 1 });
  expect(thrown).toEqual([]);
  await context.close();
});
