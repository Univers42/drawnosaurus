import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  clickElement,
  listenForPicker,
  OPEN_CANVAS,
  openBoard,
  patchedElements,
  pickTool,
  regionInk,
  relay,
  sceneElements,
  selection,
  type Board,
} from "./board.ts";

/**
 * What drawing together must not lose, as two people see it.
 *
 * Reported: people who connected saw a board missing what the others had drawn, pictures
 * and videos among it; a text appeared on other screens only when finished; and a photo
 * moved went to everyone whole each time. See `realtimeClient.ts` and `liveBroadcast.ts`.
 *
 * Every page here loads the board from a stubbed server that has nothing saved, so what
 * a page sees of another's work came over the live link or not at all.
 */

const AT = { x: OPEN_CANVAS.left + 100, y: OPEN_CANVAS.top + 80 };
const around = (x: number, y: number, width = 160, height = 110) => ({
  left: x - 10,
  top: y - 10,
  right: x + width,
  bottom: y + height,
});

type Live = ReturnType<typeof relay>;

/** The first page on the board, with a room another page can join. */
async function host(page: Page): Promise<{ board: Board; live: Live; hash: string }> {
  const live = relay();
  const board = await openBoard(page, "e2e", { live: live.join });
  return { board, live, hash: new URL(page.url()).hash };
}

/** A second person, in a browser of their own, joining `live`'s room. */
async function colleague(
  browser: Browser,
  live: Live,
  hash: string,
  init?: () => void,
): Promise<{ board: Board; context: BrowserContext; done: () => Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  // The fixture watches the first page only.
  const thrown: string[] = [];
  page.on("pageerror", (error) => thrown.push(error.message));
  const board = await openBoard(page, "e2e", { live: live.join, hash });
  const done = async () => {
    expect(thrown, "the colleague's page threw").toEqual([]);
    await context.close();
  };
  return { board, context, done };
}

async function drawBox(board: Board, x = AT.x, y = AT.y): Promise<void> {
  const { page, box } = board;
  await pickTool(page, "Rectangle");
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + 140, box.y + y + 90, { steps: 4 });
  await page.mouse.up();
}

test("someone who joins sees what was drawn before they came, saved or not", async ({
  page,
  browser,
}) => {
  const { board, live, hash } = await host(page);
  await drawBox(board);
  await drawBox(board, AT.x + 250, AT.y);
  await expect.poll(async () => (await sceneElements(page)).length).toBe(2);

  // The server has none of it: only the people already here do.
  const other = await colleague(browser, live, hash);
  await expect
    .poll(async () => (await sceneElements(other.board.page)).length, {
      message: "the newcomer was not sent what was on the board",
    })
    .toBe(2);
  await other.done();
});

test("two tabs of one browser session see each other", async ({ page, browser }) => {
  // A duplicated tab carries the session over. Two pages with one id each dropped the
  // other's frames as their own echo.
  const sameSession = () => sessionStorage.setItem("drawnosaurus:clientId", "user_duplicated");
  await page.addInitScript(sameSession);
  const { board, live, hash } = await host(page);
  const other = await colleague(browser, live, hash, sameSession);

  await drawBox(board);

  await expect.poll(async () => (await sceneElements(other.board.page)).length).toBe(1);
  await other.done();
});

test("a word shows on the other screen while it is being typed", async ({ page, browser }) => {
  const { board, live, hash } = await host(page);
  const other = await colleague(browser, live, hash);
  const theirs = other.board.page;
  const where = around(AT.x, AT.y, 260, 60);
  const before = await regionInk(theirs, where);

  await pickTool(page, "Text");
  await page.mouse.click(board.box.x + AT.x, board.box.y + AT.y);
  await page.keyboard.type("Hello there");

  // Not committed — the editor is still open — and yet it is on their screen.
  await expect
    .poll(async () => (await regionInk(theirs, where)) - before, {
      message: "the words did not appear while they were typed",
    })
    .toBeGreaterThan(0.003);
  expect(
    (await sceneElements(theirs)).filter((el) => el.type === "text"),
    "a preview, not an edit",
  ).toEqual([]);

  await page.keyboard.press("Control+Enter");
  await expect
    .poll(async () => (await sceneElements(theirs)).find((el) => el.type === "text")?.text)
    .toBe("Hello there");
  await other.done();
});

// The text being typed goes out as a gesture does, with the shape it grows and nothing
// saved until it is done (`engine/text_session.rs`).
test("a shape grows on the other screen as its label is typed", async ({ page, browser }) => {
  const { board, live, hash } = await host(page);
  const other = await colleague(browser, live, hash);
  const theirs = other.board.page;
  await drawBox(board);
  await expect.poll(async () => (await sceneElements(theirs)).length).toBe(1);
  const drawn = (await sceneElements(theirs))[0]!;
  // Just under the box as drawn, 140 × 90: empty until it grows.
  const below = { left: AT.x + 10, right: AT.x + 130, top: AT.y + 100, bottom: AT.y + 150 };
  const before = await regionInk(theirs, below);

  await page.mouse.dblclick(board.box.x + AT.x + 70, board.box.y + AT.y + 45);
  await expect(page.locator("textarea[aria-label='Text editor']")).toBeFocused();
  await page.keyboard.type("one\ntwo\nthree\nfour\nfive");

  await expect
    .poll(async () => (await regionInk(theirs, below)) - before, {
      message: "the shape did not grow on the other screen while its label was typed",
    })
    .toBeGreaterThan(0.003);
  expect((await sceneElements(theirs))[0]!.height, "a preview, not an edit").toBe(drawn.height);

  await page.keyboard.press("Escape");
  await expect
    .poll(async () => (await sceneElements(theirs)).find((el) => el.type === "rectangle")?.height)
    .toBeGreaterThan(drawn.height);
  await other.done();
});

test("what someone held is theirs no longer the moment their page goes", async ({
  page,
  browser,
}) => {
  const { board, live, hash } = await host(page);
  const other = await colleague(browser, live, hash);
  // Just drawn, so selected — so held.
  await drawBox(other.board);
  await expect.poll(async () => (await sceneElements(page)).length).toBe(1);
  await pickTool(page, "Select");
  await clickElement(board, 0);
  expect(await selection(page), "setup: the colleague holds it").toEqual([]);

  // Gone without a word, as a page reloaded or navigated away is: an unloading page
  // runs no goodbye of its own.
  await other.board.page.goto("about:blank");

  await expect
    .poll(
      async () => {
        await clickElement(board, 0);
        return (await selection(page)).length;
      },
      { message: "still held by someone who had left", timeout: 5_000 },
    )
    .toBe(1);
  await other.done();
});

/** A picture of noise: it does not compress, so its size is measurable in frames. */
async function noisyPng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 160;
    const ctx = canvas.getContext("2d")!;
    const pixels = ctx.createImageData(canvas.width, canvas.height);
    let seed = 7;
    for (let i = 0; i < pixels.data.length; i += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      pixels.data[i] = i % 4 === 3 ? 255 : seed & 0xff;
    }
    ctx.putImageData(pixels, 0, 0);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  return Buffer.from(base64, "base64");
}

test("a photo moved reaches the other screen without being sent again", async ({
  page,
  browser,
}) => {
  const { board, live, hash } = await host(page);
  const other = await colleague(browser, live, hash);
  const theirs = other.board.page;

  const listening = await listenForPicker(page);
  await pickTool(page, "Insert image");
  const file = await noisyPng(page);
  await (
    await listening.opened
  ).setFiles({ name: "noise.png", mimeType: "image/png", buffer: file });
  const picture = async (target: Page) =>
    (await sceneElements(target)).find((el) => el.type === "image") as
      { x: number; y: number; width: number; height: number; dataUrl?: string } | undefined;
  await expect
    .poll(async () => (await picture(theirs))?.dataUrl?.length ?? 0)
    .toBeGreaterThan(50_000);
  const pictureSize = (await picture(page))!.dataUrl!.length;
  await expect
    .poll(() => patchedElements(page).then((sent) => sent.some((el) => el.type === "image")))
    .toBe(true);

  const framesBefore = live.frames.length;
  const savesBefore = (await patchedElements(page)).length;
  const placed = (await picture(page))!;
  const { x, y, scale } = await page.evaluate(() => window.__drawEngine!.camera);
  const centre = {
    x: board.box.x + (placed.x + placed.width / 2) * scale + x,
    y: board.box.y + (placed.y + placed.height / 2) * scale + y,
  };
  await pickTool(page, "Select");
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + 120, centre.y + 40, { steps: 6 });
  await page.mouse.up();

  await expect.poll(async () => (await picture(theirs))!.x).toBeCloseTo(placed.x + 120 / scale, 0);
  const theirCopy = (await picture(theirs))!;
  expect(theirCopy.dataUrl?.length, "and it still has its picture").toBe(pictureSize);

  const moveFrames = live.frames.slice(framesBefore).map((frame) => frame.length);
  expect(moveFrames.length, "setup: the move went out").toBeGreaterThan(0);
  expect(Math.max(...moveFrames), "a frame of the move carried the picture").toBeLessThan(
    pictureSize / 4,
  );
  await expect.poll(async () => (await patchedElements(page)).length).toBeGreaterThan(savesBefore);
  const saved = (await patchedElements(page)).slice(savesBefore);
  expect(
    saved.filter((el) => el.type === "image" && "dataUrl" in el),
    "the save of the move carried the picture",
  ).toEqual([]);
  await other.done();
});
