import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { OPEN_CANVAS, openBoard, pickTool, relay, sceneElements, type Board } from "./board.ts";

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

interface ShareAnswer {
  lan: { origin: string; over: "wired" | "wifi" | "unknown" }[];
  public: string | null;
  tunnel?: { state: string; message?: string };
  canManage?: boolean;
}

const NAME = "http://c2r19s1.42madrid.com:5273";
const ADDRESS = "http://10.12.19.1:5273";
const PUBLIC = "https://keen-lamp-rise.trycloudflare.com";
/** This computer as `make up` finds it at school: on the wired network only. */
const BY_NAME = { origin: NAME, over: "wired" } as const;
const BY_ADDRESS = { origin: ADDRESS, over: "wired" } as const;

async function stubShare(page: Page, answer: ShareAnswer) {
  // After openBoard's catch-all, so it is asked first.
  await page.route("**/v1/share", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tunnel: { state: "off" }, canManage: true, ...answer }),
    }),
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

const primary = (page: Page) => page.locator(".link-row--primary input");

test.describe("the Share dialog", () => {
  test("puts the computer's name first, and says it is for the wired network", async ({ page }) => {
    await openBoard(page);
    await stubShare(page, { lan: [BY_NAME, BY_ADDRESS], public: null });
    await openShare(page);

    await expect(primary(page)).toHaveValue(
      /^http:\/\/c2r19s1\.42madrid\.com:5273\/boards\/e2e#room=[A-Za-z0-9_-]{43}$/,
    );
    // Not "wired or Wi-Fi": this computer is not on the Wi-Fi, and at school the Wi-Fi
    // cannot reach the wired network — a link offered there failed without a word.
    await expect(page.locator(".link-row--primary .link-title")).toHaveText(
      "People on the wired network",
    );
    await expect(page.getByText(/wired network only/)).toBeVisible();
    // The address, for when the name does not open, one click away.
    await expect(page.getByText("Other links (1)")).toBeVisible();
    const offered = await links(page);
    expect(
      offered.some((url) => /127\.0\.0\.1|localhost/.test(url)),
      offered.join(),
    ).toBe(false);
  });

  test("shows a QR code of the link, for a phone on the Wi-Fi", async ({ page }) => {
    await openBoard(page);
    await stubShare(page, { lan: [BY_NAME], public: null });
    await openShare(page);

    await page
      .locator(".link-row--primary")
      .getByRole("button", { name: /QR code/ })
      .click();
    const qr = page.getByAltText("QR code of the link");
    await expect(qr).toBeVisible();
    expect(await qr.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
  });

  test("opens the internet link from its button, and offers it once it is on", async ({ page }) => {
    await openBoard(page);
    let state: "off" | "starting" | "on" = "off";
    let asked = 0;
    const answer = () => ({
      lan: [BY_NAME],
      public: state === "on" ? PUBLIC : null,
      tunnel: { state },
      canManage: true,
    });
    await page.route("**/v1/share", (route) => {
      // On after a couple of questions, as a real tunnel comes up after a few seconds.
      if (state === "starting" && ++asked >= 2) state = "on";
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(answer()),
      });
    });
    await page.route("**/v1/share/tunnel", (route) => {
      state = route.request().method() === "POST" ? "starting" : "off";
      return route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify(answer()),
      });
    });
    await openShare(page);

    await page.getByRole("button", { name: "Share on the internet" }).click();
    await expect(page.getByText(/Opening a public link/)).toBeVisible();
    await expect(page.locator('[data-kind="internet"] input')).toHaveValue(
      /^https:\/\/keen-lamp-rise\.trycloudflare\.com\/boards\/e2e#room=/,
      { timeout: 10_000 },
    );
    // Where it was opened — not filed away under "Other links", where it looked as if
    // pressing the button had done nothing.
    await expect(page.locator('[data-kind="internet"] input')).toBeVisible();

    await page.getByRole("button", { name: "Stop sharing on the internet" }).click();
    await expect(page.locator('[data-kind="internet"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Share on the internet" })).toBeVisible();
  });

  test("offers no internet button to a guest", async ({ page }) => {
    await openBoard(page);
    await stubShare(page, { lan: [BY_NAME], public: null, canManage: false });
    await openShare(page);
    await expect(primary(page)).toHaveValue(/c2r19s1/);
    await expect(page.getByRole("button", { name: "Share on the internet" })).toHaveCount(0);
  });

  test("says so when a link would work on this computer only", async ({ page }) => {
    await openBoard(page);
    await stubShare(page, { lan: [], public: null });
    await openShare(page);

    await expect(page.locator('[data-kind="this-computer"]')).toContainText("Only this computer");
    await expect(page.locator('[data-kind="this-computer"]')).toContainText("make up");
  });
});

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
