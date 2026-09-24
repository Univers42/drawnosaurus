import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  OPEN_CANVAS,
  focusBoard,
  openBoard,
  regionInk,
  sceneElements,
  type Board,
  type SceneElement,
} from "./board.ts";

/**
 * Flip — Shift+H / Shift+V — on the pixels and on the saved scene, held to Excalidraw's
 * `actionFlip.ts`. The engine's `ci_flip.rs` pins the arithmetic for every kind; this
 * file is the half that presses the keys and looks at the screen.
 *
 * See `docs/reference/resize.md` › Flip.
 */

/** What the scene holds beyond `SceneElement`, for the fields a flip changes. */
interface Flipped extends SceneElement {
  startFixedPoint?: [number, number];
  endFixedPoint?: [number, number];
  startArrowhead?: string;
  endArrowhead?: string;
}

/** The dev handle's methods this file needs beyond those `board.ts` declares. */
interface FlipHandle {
  select(ids: string[]): void;
  insertImage(dataUrl: string, width: number, height: number, x: number, y: number): string | null;
  setPeers(peers: { id: string; name: string; color: string; holds?: string[] }[]): void;
}

/** Canvas-relative, inside `OPEN_CANVAS`, where the scenes below are placed. */
const ORIGIN = { x: OPEN_CANVAS.left + 80, y: OPEN_CANVAS.top + 60 };

/**
 * Loads elements given in canvas pixels from `ORIGIN`, converted to the world here.
 * Scene setup, not behaviour: what is under test is the flip.
 */
async function load(page: Page, elements: Record<string, unknown>[]): Promise<void> {
  await page.evaluate(
    ({ elements, origin }) => {
      const engine = window.__drawEngine!;
      const { scale } = engine.camera;
      const world = engine.screenToWorld(origin.x, origin.y);
      const style = {
        angle: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: "#a5d8ff",
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
      const placed = elements.map((element) => ({
        ...style,
        ...element,
        x: world.x + (element.x as number) / scale,
        y: world.y + (element.y as number) / scale,
        width: (element.width as number) / scale,
        height: (element.height as number) / scale,
      }));
      engine.loadScene(
        JSON.stringify({ type: "osidraw", version: 1, source: "e2e", elements: placed }),
      );
    },
    { elements, origin: ORIGIN },
  );
}

async function elementById(page: Page, id: string): Promise<Flipped> {
  const found = (await sceneElements(page)).find((element) => element.id === id);
  if (!found) throw new Error(`${id} is not on the board`);
  return found as Flipped;
}

function select(page: Page, ids: string[]): Promise<void> {
  return page.evaluate((ids) => {
    (window.__drawEngine as unknown as FlipHandle).select(ids);
  }, ids);
}

/** An arrow's first and last point, in the world. */
function ends(arrow: SceneElement): [{ x: number; y: number }, { x: number; y: number }] {
  const points = arrow.points ?? [];
  const first = points[0] ?? [0, 0];
  const last = points[points.length - 1] ?? [0, 0];
  return [
    { x: arrow.x + first[0], y: arrow.y + first[1] },
    { x: arrow.x + last[0], y: arrow.y + last[1] },
  ];
}

/** A turn in `[0, 2π)`, so `-0.4` and `2π - 0.4` compare equal. */
function turn(angle: number): number {
  const full = 2 * Math.PI;
  return ((angle % full) + full) % full;
}

/** A → B with an arrow from A's right side a quarter down to B's left side three quarters down. */
const TWO_SHAPES_AND_ARROW = [
  { id: "A", type: "rectangle", x: 0, y: 0, width: 100, height: 80 },
  { id: "B", type: "rectangle", x: 300, y: 200, width: 100, height: 80 },
  {
    id: "arr",
    type: "arrow",
    x: 105,
    y: 20,
    width: 190,
    height: 240,
    backgroundColor: "transparent",
    points: [
      [0, 0],
      [190, 240],
    ],
    startBinding: "A",
    startFixedPoint: [1, 0.25],
    startBindMode: "orbit",
    endBinding: "B",
    endFixedPoint: [0, 0.75],
    endBindMode: "orbit",
  },
];

/** Moves A there and back, so the arrow sits where its bindings put it before anything is measured. */
async function settle(board: Board): Promise<void> {
  await select(board.page, ["A"]);
  await board.page.keyboard.press("ArrowRight");
  await board.page.keyboard.press("ArrowLeft");
}

test.describe("flip", () => {
  test("an image's pixels swap sides on Shift+H, and its band moves down on Shift+V", async ({
    page,
  }) => {
    const board = await openBoard(page);
    await focusBoard(board);
    // A picture that is not its own mirror image either way: a green band along the top,
    // red on the left below it and blue on the right.
    await page.evaluate(
      ({ x, y }) => {
        const canvas = document.createElement("canvas");
        canvas.width = 200;
        canvas.height = 120;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#00c800";
        ctx.fillRect(0, 0, 200, 40);
        ctx.fillStyle = "#ff0000";
        ctx.fillRect(0, 40, 100, 80);
        ctx.fillStyle = "#0000ff";
        ctx.fillRect(100, 40, 100, 80);
        const engine = window.__drawEngine as unknown as FlipHandle;
        engine.insertImage(canvas.toDataURL("image/png"), 200, 120, x, y);
      },
      { x: ORIGIN.x + 200, y: ORIGIN.y + 150 },
    );
    await expect
      .poll(() => centroid(page, "red"), { message: "the picture is painted" })
      .not.toBeNull();

    const before = { red: (await centroid(page, "red"))!, blue: (await centroid(page, "blue"))! };
    expect(before.red.x).toBeLessThan(before.blue.x);

    await page.keyboard.press("Shift+H");
    await expect
      .poll(async () => (await centroid(page, "red"))!.x)
      .toBeGreaterThan(before.blue.x - 5);
    const flipped = { red: (await centroid(page, "red"))!, blue: (await centroid(page, "blue"))! };
    expect(flipped.red.x, "red is on the right now").toBeGreaterThan(flipped.blue.x);
    expect(Math.abs(flipped.red.x - before.blue.x)).toBeLessThan(3);

    const green = (await centroid(page, "green"))!;
    expect(green.y).toBeLessThan(flipped.red.y);
    await page.keyboard.press("Shift+V");
    await expect
      .poll(async () => (await centroid(page, "green"))!.y)
      .toBeGreaterThan(flipped.red.y);
  });

  test("a bound arrow is mirrored with its two shapes", async ({ page }) => {
    const board = await openBoard(page);
    await focusBoard(board);
    await load(page, TWO_SHAPES_AND_ARROW);
    await settle(board);
    const a = await elementById(page, "A");
    const b = await elementById(page, "B");
    const [start, end] = ends(await elementById(page, "arr"));
    const mid = (a.x + b.x + b.width) / 2;

    await page.keyboard.press("Control+a");
    await page.keyboard.press("Shift+H");

    await expect
      .poll(async () => (await elementById(page, "arr")).startFixedPoint)
      .toEqual([0, 0.25]);
    const arrow = await elementById(page, "arr");
    expect(arrow.endFixedPoint).toEqual([1, 0.75]);
    expect([arrow.startBinding, arrow.endBinding]).toEqual(["A", "B"]);
    const [s, e] = ends(arrow);
    expect(Math.abs(s.x - (2 * mid - start.x))).toBeLessThan(1);
    expect(Math.abs(s.y - start.y)).toBeLessThan(1);
    expect(Math.abs(e.x - (2 * mid - end.x))).toBeLessThan(1);
    expect(Math.abs(e.y - end.y)).toBeLessThan(1);
  });

  test("a turned text turns the other way, and still reads forwards", async ({ page }) => {
    const board = await openBoard(page);
    await focusBoard(board);
    await load(page, [
      {
        id: "t",
        type: "text",
        x: 0,
        y: 0,
        width: 120,
        height: 25,
        angle: 0.4,
        text: "Hello",
        fontSize: 20,
        backgroundColor: "transparent",
      },
      { id: "r", type: "rectangle", x: 300, y: 0, width: 100, height: 80 },
    ]);

    await page.keyboard.press("Control+a");
    await page.keyboard.press("Shift+H");

    await expect
      .poll(async () => turn((await elementById(page, "t")).angle ?? 0))
      .toBeCloseTo(2 * Math.PI - 0.4, 9);
    expect((await elementById(page, "t")).width).toBeGreaterThan(0);
  });

  test("Shift+H on a bound arrow alone swaps its heads and moves nothing", async ({ page }) => {
    const board = await openBoard(page);
    await focusBoard(board);
    await load(page, TWO_SHAPES_AND_ARROW);
    await settle(board);
    const before = await elementById(page, "arr");

    await select(page, ["arr"]);
    await page.keyboard.press("Shift+H");

    await expect.poll(async () => (await elementById(page, "arr")).startArrowhead).toBe("arrow");
    const after = await elementById(page, "arr");
    expect(after.endArrowhead).toBe("none");
    expect(ends(after)).toEqual(ends(before));
  });

  test("a frame's name starts at the frame's left edge whatever text was drawn before it", async ({
    page,
  }) => {
    const board = await openBoard(page);
    await focusBoard(board);
    // Centred text painted before the name: the name used to inherit its alignment and
    // sit centred on the frame's left edge, half of it outside the frame.
    await load(page, [
      { id: "f", type: "frame", x: 100, y: 60, width: 300, height: 200, name: "Frame name" },
      {
        id: "t",
        type: "text",
        x: 100,
        y: 300,
        width: 200,
        height: 25,
        text: "centred",
        fontSize: 20,
        textAlign: "center",
        backgroundColor: "transparent",
      },
    ]);
    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));

    const left = ORIGIN.x + 100;
    const top = ORIGIN.y + 60;
    const band = { top: top - 20, bottom: top - 4 };
    await expect
      .poll(() => regionInk(page, { left: left + 2, right: left + 60, ...band }), {
        message: "the name is drawn right of the frame's left edge",
      })
      .toBeGreaterThan(0.02);
    expect(
      await regionInk(page, { left: left - 60, right: left - 2, ...band }),
      "and nothing of it left of that edge",
    ).toBe(0);
  });

  test("a peer's name starts inside its tag whatever text was drawn before it", async ({
    page,
  }) => {
    const board = await openBoard(page);
    await focusBoard(board);
    // A centred text being dragged is painted straight onto the screen, and used to leave
    // its alignment there: the name on a peer's tag, drawn after it, sat centred on the
    // tag's left inset, its second half missing from the tag.
    await load(page, [
      { id: "p", type: "rectangle", x: 100, y: 100, width: 160, height: 60 },
      {
        id: "t",
        type: "text",
        x: 100,
        y: 300,
        width: 200,
        height: 25,
        text: "centred",
        fontSize: 20,
        textAlign: "center",
        backgroundColor: "transparent",
      },
    ]);
    // Selected before the peer arrives, so taking it tells the host nothing new.
    await select(page, ["t"]);
    await page.evaluate(() => {
      (window.__drawEngine as unknown as FlipHandle).setPeers([
        { id: "peer", name: "Ada Lovelace", color: "#e03131", holds: ["p"] },
      ]);
    });

    const at = { x: board.box.x + ORIGIN.x + 200, y: board.box.y + ORIGIN.y + 312 };
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 30, at.y + 40, { steps: 4 });
    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));

    // Above the shape, clear of the trace in the peer's colour along its top edge.
    const tag = {
      left: ORIGIN.x + 60,
      right: ORIGIN.x + 300,
      top: ORIGIN.y + 50,
      bottom: ORIGIN.y + 96,
    };
    const ink = await nameInTag(page, tag);
    await page.mouse.up();
    expect(ink.found, "no tag in the peer's colour above what they hold").toBe(true);
    expect(ink.rightHalf, "the name reaches into the right half of its tag").toBeGreaterThan(0.05);
  });
});

/**
 * The peer's tag (its red pill) inside `region`, canvas-relative CSS pixels, and how much
 * of the right half of its body is covered by the white name — clear of the rounded ends.
 */
function nameInTag(
  page: Page,
  region: { left: number; right: number; top: number; bottom: number },
): Promise<{ found: boolean; rightHalf: number }> {
  return page.evaluate((region) => {
    const canvas = document.querySelector("canvas")!;
    const ctx = canvas.getContext("2d")!;
    const scale = canvas.width / canvas.getBoundingClientRect().width;
    const [x0, y0] = [Math.round(region.left * scale), Math.round(region.top * scale)];
    const w = Math.round((region.right - region.left) * scale);
    const h = Math.round((region.bottom - region.top) * scale);
    const { data } = ctx.getImageData(x0, y0, w, h);
    const px = (x: number, y: number) => data.slice((y * w + x) * 4, (y * w + x) * 4 + 3);
    const red = (x: number, y: number) => {
      const [r, g, b] = px(x, y);
      return r! > 200 && g! < 90 && b! < 90;
    };
    let [minX, minY, maxX, maxY] = [w, h, -1, -1];
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (!red(x, y)) continue;
        [minX, minY] = [Math.min(minX, x), Math.min(minY, y)];
        [maxX, maxY] = [Math.max(maxX, x), Math.max(maxY, y)];
      }
    }
    if (maxX < 0) return { found: false, rightHalf: 0 };
    const inset = Math.round(4 * scale);
    let [lit, all] = [0, 0];
    for (let y = minY + inset; y <= maxY - inset; y += 1) {
      for (let x = Math.ceil((minX + maxX) / 2) + inset; x <= maxX - inset; x += 1) {
        const [, g, b] = px(x, y);
        all += 1;
        if (g! > 150 && b! > 150) lit += 1;
      }
    }
    return { found: true, rightHalf: all === 0 ? 0 : lit / all };
  }, region);
}

/**
 * The middle of one colour's pixels on the canvas, canvas-relative CSS pixels — null when
 * there are none. Strict thresholds, so the selection chrome (a violet) is never counted
 * as blue.
 */
function centroid(
  page: Page,
  colour: "red" | "green" | "blue",
): Promise<{ x: number; y: number } | null> {
  return page.evaluate((colour) => {
    const canvas = document.querySelector("canvas")!;
    const ctx = canvas.getContext("2d")!;
    const scale = canvas.width / canvas.getBoundingClientRect().width;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
        const hit =
          colour === "red"
            ? r > 200 && g < 60 && b < 60
            : colour === "green"
              ? g > 150 && r < 60 && b < 60
              : b > 200 && r < 60 && g < 60;
        if (hit) {
          sx += x;
          sy += y;
          n += 1;
        }
      }
    }
    return n === 0 ? null : { x: sx / n / scale, y: sy / n / scale };
  }, colour);
}
