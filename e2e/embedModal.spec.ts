import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  focusBoard,
  openBoard,
  sceneElements,
  selection,
  waitForCameraStable,
  type Board,
  type SceneElement,
} from "./board.ts";

/**
 * Asking for a link to embed, and getting one.
 *
 * `prompt/shortkey.md:294` — "Paste supported embed URLs" — is the line, and this is the
 * way in. The engine half is pinned hard already (`ci_embed.rs`: the allow-list, every
 * spelling of a provider's link, the rewrite into a player, the intrinsic sizes) and the
 * host half too (`draw-chrome/embed.test.ts`: the sandbox, the referrer, where a frame
 * goes). What nothing pinned was the path a person takes. `e2e/embed.spec.ts` puts its
 * embeds on the board with `window.__drawEngine.insertEmbed(url, x, y)`, which steps over
 * the dialog entirely — so the dialog could be wired to nothing at all, or refuse
 * everything, and that file would stay green. Every test here goes in through the field.
 *
 * The oracle has no dialog. It recognises a pasted link in
 * `App.tsx@1118751f:4711-4757` — `maybeParseEmbedSrc` on each line of the clipboard, kept
 * only if `embeddableURLValidator` agrees, then `insertEmbeddableElement` — and a link it
 * will not frame it pastes as *text* rather than refusing (`App.tsx@1118751f:4757`,
 * `addTextFromPaste`). Ours asks, and then says no, which is the divergence the refusal
 * tests below are written against; the size it decides on matches the oracle's, which
 * takes the provider's own `intrinsicSize` (`App.tsx@1118751f:10048-10050`).
 *
 * **Nothing here reaches the network.** The dialog is filled from a person, and the only
 * request a link could cause is the framed page's — answered by `stubProviders` from a
 * route, before it leaves the browser. The `leaked` list it hands back is the other half:
 * every cross-origin request the page tries is recorded, and a test that finds one it did
 * not expect fails on it by name. (The board also pulls a webfont from
 * `apps/web/src/app.css:1`; that is the app's business, it is not what these tests
 * measure, and no assertion here depends on it.)
 */

/** What the fake provider is framed as. Never a real player, never a real network. */
const FAKE_PLAYER = `<!doctype html><html><body style="margin:0;height:100vh;background:#223">
<output id="presses">0</output></body></html>`;

/**
 * The hosts the dialog is allowed to frame — the ones these tests use. Anything else that
 * turns up in a frame is a leak, and the `leaked` list says so.
 */
const PROVIDERS =
  /^https:\/\/(www\.youtube\.com|player\.vimeo\.com|player\.twitch\.tv|platform\.twitter\.com)\//;

/** Where the app itself is served from, so "somewhere else" can be recognised. */
const APP_ORIGIN = new URL(
  process.env.E2E_BASE_URL ??
    `http://${process.env.E2E_HOST ?? "127.0.0.1"}:${process.env.E2E_PORT ?? 5473}`,
).origin;

/**
 * The app's own webfont, fetched from Google's CDN by `apps/web/src/app.css:1`.
 *
 * Not something an embed needs and not something any assertion here reads — §11 already
 * says never to assert on font-metric pixels, precisely because this request is not
 * dependable. It is named rather than swallowed so the leak list below stays a list of
 * surprises.
 */
const APP_FONT = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

/**
 * Answers a framed page from a route, and records every request that leaves this origin.
 *
 * Both halves matter. The route is what keeps the test off youtube.com; the recorder is
 * what makes the *absence* of other traffic an assertion rather than a hope — a spec that
 * quietly started depending on a third party would fail on `leaked`, with the URL in the
 * message, instead of failing tomorrow for reasons that have nothing to do with this code.
 */
async function stubProviders(page: Page): Promise<string[]> {
  const leaked: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (
      !/^https?:\/\//.test(url) ||
      url.startsWith(APP_ORIGIN) ||
      APP_FONT.test(url) ||
      PROVIDERS.test(url)
    ) {
      return;
    }
    leaked.push(url);
  });
  await page.route(PROVIDERS, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: FAKE_PLAYER }),
  );
  return leaked;
}

/** The engine's own view of one live frame — where it goes on screen, and at what size. */
interface Frame {
  id: string;
  url: string;
  kind: "video" | "generic";
  scale: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** `board.ts` does not carry the one field an embed has; declared here, not added there. */
interface EmbedElement extends SceneElement {
  /** The **resolved** link, not what was pasted — `element.rs:496-500`. */
  embedUrl?: string;
}

const dialog = (page: Page) => page.getByRole("dialog", { name: "Embed a web page" });
const field = (page: Page) => dialog(page).getByRole("textbox", { name: "Link to embed" });

/** A watch page, not a player: what a person actually has on their clipboard. */
const WATCH_PAGE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
/** The same video, shared the other way. One link, two spellings (`ci_embed.rs:110-125`). */
const SHORT_PAGE = "https://youtu.be/dQw4w9WgXcQ";
/** What the engine rewrites either of them to (`ci_embed.rs:99-108`). */
const PLAYER = "https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1";

/** Every live frame on the board, by the engine's own reckoning. */
function frames(page: Page): Promise<Frame[]> {
  return page.evaluate(() => JSON.parse(window.__drawEngine!.embedFramesJson()) as Frame[]);
}

async function frameOf(page: Page, id: string): Promise<Frame> {
  const all = await frames(page);
  const frame = all.find((one) => one.id === id);
  if (!frame) throw new Error(`the engine reports no frame for ${id}, only ${all.length}`);
  return frame;
}

/**
 * The nth element, named rather than indexed.
 *
 * Every caller has just asserted the length, so this never fires — and when it does, the
 * message says which count was wrong, where `elements[2].x` on a short array says
 * "cannot read properties of undefined" twenty lines from the assertion that failed.
 */
function at<T>(elements: T[], which: number): T {
  const element = elements[which];
  if (!element) throw new Error(`there is no element ${which} of ${elements.length}`);
  return element;
}

/**
 * Opens the dialog the engine's own `W` does, and waits for the field to hold the
 * keyboard. `ci_shortcuts.rs` pins that the chord selects the embed tool;
 * `DrawSurface.svelte:2063-2064` is what turns that into this dialog. The wait is not
 * politeness: without it a keystroke meant for the link lands on the board, which is the
 * whole of the `46dc698` fix.
 */
async function openEmbedDialog(board: Board): Promise<void> {
  await focusBoard(board);
  await board.page.keyboard.press("w");
  await expect(dialog(board.page), "the embed dialog did not open").toBeVisible();
  await expect(field(board.page), "the field did not take the keyboard").toBeFocused();
}

/** Puts a link on the clipboard for real, and pastes it with a real chord. */
async function pasteInto(page: Page, text: string): Promise<void> {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
  await page.keyboard.press("Control+V");
  await expect(field(page), "the paste put nothing in the field").toHaveValue(text);
}

/** The one embed the dialog was supposed to make, of the one element it should have made. */
async function theOnlyEmbed(page: Page): Promise<EmbedElement> {
  const elements = (await sceneElements(page)) as EmbedElement[];
  expect(elements, "the board did not end up with exactly one element").toHaveLength(1);
  const element = at(elements, 0);
  expect(element.type, "what landed on the board is not an embed").toBe("embed");
  return element;
}

test.describe("a supported link pasted into the dialog", () => {
  test("becomes an embed, at the provider's own shape, in the middle of the viewport", async ({
    page,
  }, testInfo) => {
    const leaked = await stubProviders(page);
    const board = await openBoard(page);
    await openEmbedDialog(board);

    // The resolution is shown before anything is placed, so a refused link never reaches
    // the board (`DrawEmbedModal.svelte:33-34` and `:83-87`).
    await pasteInto(page, WATCH_PAGE);
    await expect(dialog(page).getByRole("status")).toContainText(`Video · embeds as ${PLAYER}`);

    await page.keyboard.press("Enter");
    await expect(dialog(page)).toHaveCount(0);

    const embed = await theOnlyEmbed(page);
    // The stored link is the resolved one, not the pasted one: a watch page framed in an
    // iframe shows a refusal rather than a video (`element.rs:496-500`).
    expect(embed.embedUrl, "the element kept the link as it was pasted").toBe(PLAYER);
    // Sized as the provider declares — 560×315, `scene/embed.rs:77-78` — and the viewport
    // allows 400 tall at this window, so nothing caps it. The oracle sizes an embeddable
    // the same way, from `getEmbedLink(...).intrinsicSize` (`App.tsx@1118751f:10048-10050`).
    expect(embed.width, "a 16:9 player is not 16:9").toBeCloseTo(560, 0);
    expect(embed.height, "a 16:9 player is not 16:9").toBeCloseTo(315, 0);
    // A frame round a live page, not a drawing of one: a hand-drawn border would never
    // line up with the rectangle the browser clips the page to (`image.rs:104-107`).
    expect(embed.roughness, "a frame round a page is drawn rough").toBe(0);
    expect(embed.backgroundColor, "a frame round a page is filled in").toBe("transparent");
    // It arrives selected, so the keyboard can work on it at once, and it is one undo step
    // (`image.rs:111-112`).
    expect(await selection(page), "the embed did not arrive selected").toEqual([embed.id]);

    // Placed on the viewport's centre (`DrawSurface.svelte:938-940`), read back through
    // the engine's own screen mapping rather than from the DOM, so this is the placement
    // the engine decided and not a number this file worked out.
    const frame = await frameOf(page, embed.id);
    expect(frame.x + frame.width / 2, "not in the middle of the viewport").toBeCloseTo(
      board.box.width / 2,
      0,
    );
    expect(frame.y + frame.height / 2, "not in the middle of the viewport").toBeCloseTo(
      board.box.height / 2,
      0,
    );

    // And it is on the board, not merely in the JSON: the page is framed and loaded.
    await expect(page.locator('iframe[title="Embedded page"]')).toHaveCount(1);
    await expect(page.locator('iframe[title="Embedded page"]')).toHaveAttribute("src", PLAYER);
    expect(leaked, "a spec reached a third party").toEqual([]);

    await page.screenshot({ path: testInfo.outputPath("embed-accepted.png") });
  });

  test("lands in the same place every time, and follows the camera when it moves", async ({
    page,
  }) => {
    // The anti-flake pin. Placement follows the camera and nothing else: the same video,
    // twice, through the same dialog, from the same camera, and then once more from a
    // camera that has moved. An embed that wandered — a pointer position, a timestamp, a
    // collision nudge — would leave every spec that aims at an embed aiming at nothing,
    // which is the failure this file exists to make impossible.
    await stubProviders(page);
    const board = await openBoard(page);

    await openEmbedDialog(board);
    await page.keyboard.type(WATCH_PAGE);
    await page.keyboard.press("Enter");
    await expect(dialog(page)).toHaveCount(0);
    const first = await theOnlyEmbed(page);

    // The same video, spelled the other way, so the comparison is not an artefact of a
    // fixture string: `ci_embed.rs:110-125` is the rewrite that makes them one link.
    await openEmbedDialog(board);
    await page.keyboard.type(SHORT_PAGE);
    await page.keyboard.press("Enter");
    await expect(dialog(page)).toHaveCount(0);

    const two = (await sceneElements(page)) as EmbedElement[];
    expect(two, "the second embed did not land").toHaveLength(2);
    const second = at(two, 1);
    expect(second.id, "the same element was inserted twice").not.toBe(first.id);
    expect(second.embedUrl, "two spellings, one link").toBe(first.embedUrl);
    expect(second.x, "the second embed landed elsewhere").toBeCloseTo(first.x, 0);
    expect(second.y, "the second embed landed elsewhere").toBeCloseTo(first.y, 0);
    expect(second.width).toBeCloseTo(first.width, 0);
    expect(second.height).toBeCloseTo(first.height, 0);

    // Now move the camera. The insert follows it: the frame is still in the middle of the
    // viewport, but at a different place on the board, and the embed keeps its size there
    // while the box on screen follows the zoom. Those three together are what "sane and
    // deterministic" means for a thing that lands where nobody clicked.
    await page.evaluate(() => window.__drawEngine!.zoomAt(0, 0, 0.5));
    await waitForCameraStable(page);

    await openEmbedDialog(board);
    await page.keyboard.type(WATCH_PAGE);
    await page.keyboard.press("Enter");
    await expect(dialog(page)).toHaveCount(0);

    const three = (await sceneElements(page)) as EmbedElement[];
    expect(three, "the third embed did not land").toHaveLength(3);
    const last = at(three, 2);
    expect(last.embedUrl).toBe(PLAYER);
    // The centre, doubled: at half the zoom the same screen point is twice as far out on
    // the board, and the embed keeps its own size while its top-left corner moves.
    expect(last.x + last.width / 2, "the insert ignored the camera it was given").toBeCloseTo(
      (first.x + first.width / 2) * 2,
      0,
    );
    expect(last.y + last.height / 2, "the insert ignored the camera it was given").toBeCloseTo(
      (first.y + first.height / 2) * 2,
      0,
    );
    // The same size on the board, half the size on the screen: what the drawing says is
    // independent of how far it is being looked at from.
    expect(last.width, "zooming changed the embed's size on the board").toBeCloseTo(560, 0);
    const frame = await frameOf(page, last.id);
    expect(frame.scale, "the frame was not told about the zoom").toBeCloseTo(0.5, 2);
    expect(frame.width, "the frame did not follow the zoom").toBeCloseTo(280, 0);
    expect(frame.x + frame.width / 2, "not in the middle of the viewport any more").toBeCloseTo(
      board.box.width / 2,
      0,
    );
  });
});

test.describe("a link the rules refuse", () => {
  test("is named as refused, and nothing is placed", async ({ page }, testInfo) => {
    const leaked = await stubProviders(page);
    const board = await openBoard(page);
    await openEmbedDialog(board);

    // Three refusals with three different reasons, because the engine has three: a host
    // that is not on the list, a scheme it will never frame (`scene/embed.rs:180-184` —
    // `javascript:` in a frame is one of the holes the allow-list exists to close), and
    // something that is not a link at all.
    for (const refused of ["https://example.com/a-video", "javascript:alert(1)", "wibble"]) {
      await field(page).fill(refused);

      // Said out loud, and marked on the field (`DrawEmbedModal.svelte:75` and `:78-82`).
      // A dialog that says nothing is a dialog that accepts everything.
      await expect(field(page), `${refused} was not marked invalid`).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      const alert = dialog(page).getByRole("alert");
      await expect(alert, `${refused} was not refused`).toContainText(
        "That link cannot be embedded",
      );
      await expect(alert).toContainText("youtube.com");
      await expect(dialog(page).getByRole("status"), `${refused} resolved anyway`).toHaveCount(0);

      // The button is the reason nothing is placed: it is disabled, so there is no second
      // way in — and Enter is guarded as well (`DrawEmbedModal.svelte:36-41`).
      await expect(dialog(page).getByRole("button", { name: "Embed" })).toBeDisabled();
      await page.keyboard.press("Enter");
      await expect(dialog(page), `${refused} closed the dialog`).toBeVisible();
      expect(await sceneElements(page), `${refused} put something on the board`).toEqual([]);
      expect(await frames(page), `${refused} framed a page`).toEqual([]);
      await expect(page.locator("iframe"), `${refused} mounted a frame`).toHaveCount(0);
    }
    expect(leaked, "a spec reached a third party").toEqual([]);

    await page.screenshot({ path: testInfo.outputPath("embed-refused.png") });
  });

  test("is the same dialog, one edit away from one that works", async ({ page }) => {
    // The control the refusal test cannot be trusted without: the board is not empty
    // because nothing works through this dialog. One select-all and a retype *in the
    // dialog that has just refused*, and the very same dialog places the very same element
    // the accepted case pins. A refusal test without this could be green because the
    // dialog was dead.
    await stubProviders(page);
    const board = await openBoard(page);
    await openEmbedDialog(board);

    await field(page).fill("https://example.com/a-video");
    await expect(dialog(page).getByRole("alert")).toBeVisible();
    await page.keyboard.press("Enter");
    expect(await sceneElements(page), "the refused link put something on the board").toEqual([]);

    await field(page).press("Control+a");
    await page.keyboard.type(WATCH_PAGE);
    await expect(dialog(page).getByRole("alert"), "the refusal outlived the fix").toHaveCount(0);
    await expect(dialog(page).getByRole("status")).toContainText(PLAYER);
    await expect(dialog(page).getByRole("button", { name: "Embed" })).toBeEnabled();
    await page.keyboard.press("Enter");
    await expect(dialog(page)).toHaveCount(0);

    expect((await theOnlyEmbed(page)).embedUrl).toBe(PLAYER);
  });
});

test.describe("a field with nothing usable in it", () => {
  test("is neither a link nor a refused one, and places nothing", async ({ page }, testInfo) => {
    // The degenerate state, and the one a test walks through without exercising. It is
    // *not* the refusal case and must never be reported as one: nothing was pasted, so
    // nothing was refused, and someone who has not decided yet is to be invited rather
    // than told off. `DrawEmbedModal.svelte:34` is the one line in the dialog that keeps
    // the two apart — `link.trim().length > 0` — and it is what is pinned here: the hint
    // is still the hint, with no `role="alert"` over the top of it.
    const leaked = await stubProviders(page);
    const board = await openBoard(page);
    await openEmbedDialog(board);

    await page.keyboard.press("Enter");
    await expect(dialog(page), "Enter on an empty field closed the dialog").toBeVisible();
    expect(await sceneElements(page), "Enter on an empty field put something on the board").toEqual(
      [],
    );

    for (const blank of ["   ", "\t", " \t "]) {
      await field(page).fill(blank);
      await expect(dialog(page).getByRole("status"), `${blank} resolved`).toHaveCount(0);
      await expect(dialog(page).getByRole("alert"), `${blank} was called refused`).toHaveCount(0);
      await expect(dialog(page).locator("p.hint"), `${blank} lost the hint`).toHaveCount(1);
      await expect(dialog(page).locator("p.hint")).toContainText("Paste a link");
      await expect(dialog(page).getByRole("button", { name: "Embed" })).toBeDisabled();

      await page.keyboard.press("Enter");
      await expect(dialog(page), `${blank} closed the dialog`).toBeVisible();
      expect(await sceneElements(page), `${blank} put something on the board`).toEqual([]);
      expect(await frames(page), `${blank} framed a page`).toEqual([]);
    }
    await page.screenshot({ path: testInfo.outputPath("embed-empty.png") });

    // And the field was never dead: the same dialog, still open, takes a link.
    await field(page).press("Control+a");
    await page.keyboard.type(WATCH_PAGE);
    await expect(dialog(page).getByRole("status")).toContainText(PLAYER);
    await page.keyboard.press("Enter");
    await expect(dialog(page)).toHaveCount(0);
    expect((await theOnlyEmbed(page)).embedUrl).toBe(PLAYER);
    expect(leaked, "a spec reached a third party").toEqual([]);
  });

  test("places nothing when the dialog is cancelled", async ({ page }) => {
    // A resolved link is a live one, and the button that turns it into a frame is right
    // there. Cancelling has to be the way out that does not.
    const leaked = await stubProviders(page);
    const board = await openBoard(page);
    await openEmbedDialog(board);

    await pasteInto(page, WATCH_PAGE);
    await expect(dialog(page).getByRole("status")).toContainText(PLAYER);
    await dialog(page).getByRole("button", { name: "Cancel" }).click();

    await expect(dialog(page)).toHaveCount(0);
    expect(await sceneElements(page), "cancelling put something on the board").toEqual([]);
    expect(await frames(page), "cancelling framed a page").toEqual([]);
    await expect(page.locator("iframe")).toHaveCount(0);
    expect(leaked, "a spec reached a third party").toEqual([]);
  });
});
