import { expect, test } from "../fixtures.ts";
import { drawAndSave, drawingReady, pictureStoredAt } from "./drawing.ts";

/**
 * A drawing never shared goes nowhere — the spec's scenario 5, and its anti-goal "an
 * unshared drawing that leaves the browser": a drawing connects to nothing until it has
 * been shared.
 *
 * Everything the page asks for is recorded while a drawing is opened, drawn on, saved —
 * its gallery picture too — and opened again. What may go out is a read of the app's own
 * files from where it is served. Not a write of any kind, and nothing at either of the
 * Docker build's server entrances, `/v1` (the API) and `/ws` (the relay).
 */

/** The server's entrances, as the Docker build's gateway routes them. */
const SERVER = /^\/(v1|ws)(\/|$)/;

test("a drawing never shared sends nothing: opened, drawn on, saved and opened again", async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? "http://unset").origin;
  const left: string[] = [];
  const sockets: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    // Read from this page's own memory: never on the network.
    if (url.protocol === "data:" || url.protocol === "blob:") return;
    const ownFile =
      url.origin === origin && request.method() === "GET" && !SERVER.test(url.pathname);
    if (!ownFile) left.push(`${request.method()} ${request.url()}`);
  });
  page.on("websocket", (socket) => {
    const url = new URL(socket.url());
    // Vite's hot reload, `/?token=…` on the dev server itself: this suite runs `vite dev`
    // (`playwright.config.ts`), and the build that ships has no such socket.
    const hotReload =
      url.host === new URL(origin).host && url.pathname === "/" && url.searchParams.has("token");
    if (!hotReload) sockets.push(socket.url());
  });

  // At its address rather than through `/`, so this needs nothing but the drawing itself.
  const slug = "nevershared1";
  await page.goto(`/boards/${slug}`);
  await drawAndSave(await drawingReady(page));
  // The picture is made a few seconds after the save (`thumbnailUploader.ts`): past it,
  // everything a save sets off has happened.
  await expect.poll(() => pictureStoredAt(page, slug), { timeout: 10_000 }).not.toBeNull();
  await page.reload();
  await drawingReady(page);

  // Soft, so a failure lists both.
  expect.soft(left, "what left for somewhere other than the app's own files").toEqual([]);
  expect.soft(sockets, "the websockets the page opened").toEqual([]);
});
