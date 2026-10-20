import { statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Request } from "@playwright/test";
import { expect, test } from "../fixtures.ts";
import { drawAndSave, drawingReady, openApp, pictureStoredAt } from "./drawing.ts";

/**
 * A drawing never shared goes nowhere — the spec's scenario 5, and its anti-goal "an
 * unshared drawing that leaves the browser": a drawing connects to nothing until it has
 * been shared.
 *
 * Everything the page asks for is recorded while the app is opened, a drawing drawn on,
 * saved — its gallery picture too — and opened again. Each request must be a read of one of
 * the app's own files, from where it is served; anything else fails, whatever its address.
 */

/** The web app on this disk: the spec runs beside the dev server (`playwright.config.ts`). */
const WEB = fileURLToPath(new URL("../../apps/web/", import.meta.url));

/** The pages of the app this spec opens: `/`, and a drawing. Each is the app's one page. */
const PAGE = /^\/(boards\/[a-z0-9]{6,32})?$/;

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/**
 * Whether `request` reads one of the app's own files, as `vite dev` serves them: a page of
 * the app; a module of Vite's own (`/@vite/…`, `/@id/…`, code it names rather than keeps on a
 * path); or a file on this disk — the web app's sources, its `static/` folder and Vite's
 * prebundled dependencies under `apps/web`, or one Vite serves by its absolute path
 * (`/@fs/…`: the engine's package and sources).
 */
function ownFile(request: Request, origin: string): boolean {
  const url = new URL(request.url());
  if (url.origin !== origin || request.method() !== "GET") return false;
  const path = decodeURIComponent(url.pathname);
  if (request.resourceType() === "document") return PAGE.test(path);
  if (/^\/@(vite|id)\//.test(path)) return true;
  if (path.startsWith("/@fs/")) return isFile(path.slice("/@fs".length));
  return isFile(join(WEB, path)) || isFile(join(WEB, "static", path));
}

test("a drawing never shared sends nothing: opened, drawn on, saved and opened again", async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? "http://unset").origin;
  const left: string[] = [];
  const sockets: string[] = [];
  page.on("request", (request) => {
    // Read from this page's own memory: never on the network.
    if (/^(data|blob):/.test(request.url())) return;
    if (!ownFile(request, origin)) left.push(`${request.method()} ${request.url()}`);
  });
  page.on("websocket", (socket) => {
    const url = new URL(socket.url());
    // Vite's hot reload, `/?token=…` on the dev server itself. This suite runs `vite dev`
    // (`playwright.config.ts`), whose client opens it whatever the config says
    // (`vite/dist/client/client.mjs`, `transport.connect`); the build that ships has none.
    const hotReload =
      url.host === new URL(origin).host && url.pathname === "/" && url.searchParams.has("token");
    if (!hotReload) sockets.push(socket.url());
  });

  const { board, slug } = await openApp(page);
  await drawAndSave(board);
  // The picture is made a few seconds after the save (`thumbnailUploader.ts`): past it,
  // everything a save sets off has happened.
  await expect.poll(() => pictureStoredAt(page, slug), { timeout: 10_000 }).not.toBeNull();
  await page.reload();
  await drawingReady(page);

  // Soft, so a failure lists both.
  expect.soft(left, "what the page asked for that is not one of the app's files").toEqual([]);
  expect.soft(sockets, "the websockets the page opened").toEqual([]);
});
