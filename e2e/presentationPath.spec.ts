import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { camera, focusBoard, openBoard, sceneElements, type Board } from "./board.ts";

/**
 * The presentation path, Prezi's way: the frames as camera stops in an order the path
 * editor sets, and the camera flying between them — out and back in, van Wijk & Nuij's
 * path (`camera.ts` › `flight`). See `docs/reference/presentation.md`.
 *
 * Motion is on here, unlike `presentation.spec.ts`: what is under test is the flight
 * itself — that it lands on the stop to the pixel, and that every frame it draws on the
 * way fits in a 60Hz frame.
 */

const FRAME_BUDGET_MS = 1000 / 60;
const PRESENT_MARGIN = 24;

type Frame = { id: string; name: string; x: number; y: number; width: number; height: number };

/**
 * Ten frames, nested three deep: an overview, two acts in it, scenes in each act and a
 * detail in a scene — the shape a Prezi takes. "Close" is drawn first, so the path the
 * board opens with (the order frames were made) puts it first; the editor moves it last.
 */
const CLOSE: Frame = { id: "close", name: "Close", x: 2700, y: 300, width: 600, height: 400 };
const PATH: Frame[] = [
  { id: "overview", name: "Overview", x: 0, y: 0, width: 6000, height: 3600 },
  { id: "act1", name: "Act 1", x: 200, y: 900, width: 2400, height: 1500 },
  { id: "scene1", name: "Scene 1", x: 400, y: 1200, width: 800, height: 500 },
  { id: "detail1", name: "Detail 1", x: 500, y: 1300, width: 200, height: 120 },
  { id: "scene2", name: "Scene 2", x: 1500, y: 1200, width: 800, height: 500 },
  { id: "act2", name: "Act 2", x: 3300, y: 1800, width: 2400, height: 1500 },
  { id: "scene3", name: "Scene 3", x: 3500, y: 2000, width: 800, height: 500 },
  { id: "scene4", name: "Scene 4", x: 4600, y: 2600, width: 800, height: 500 },
  { id: "detail4", name: "Detail 4", x: 4800, y: 2750, width: 240, height: 150 },
  CLOSE,
];

const STYLE = {
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  roundness: null,
  seed: 1,
  version: 1,
  versionNonce: 1,
  updated: 0,
  isDeleted: false,
};

/** The frames, in the order they were drawn, and ~400 shapes across the board to draw. */
function scene(frames: Frame[]) {
  const shapes = Array.from({ length: 400 }, (_, i) => ({
    id: `r${i}`,
    type: i % 3 === 0 ? "ellipse" : "rectangle",
    x: 60 + (i % 25) * 235,
    y: 60 + Math.floor(i / 25) * 215,
    width: 140,
    height: 90,
    backgroundColor: i % 2 ? "#a5d8ff" : "transparent",
    fillStyle: "hachure",
  }));
  return [
    ...frames.map((frame) => ({ ...STYLE, ...frame, type: "frame" })),
    ...shapes.map((shape) => ({ ...STYLE, ...shape, seed: 7 + Number(shape.id.slice(1)) })),
  ];
}

const panel = (page: Page) => page.getByRole("complementary", { name: "Presentation path" });

async function openPathEditor(board: Board): Promise<void> {
  await focusBoard(board);
  await board.page.keyboard.press("Control+/");
  await board.page.keyboard.type("presentation path");
  await board.page.keyboard.press("Enter");
  await expect(panel(board.page)).toBeVisible();
}

/** The stops as the editor lists them. */
async function stopNames(page: Page): Promise<string[]> {
  const labels = await panel(page).locator(".stop .name").allTextContents();
  return labels.map((label) => label.trim());
}

/** The camera `fitCamera` gives a frame — a second copy, as `presentation.spec.ts` keeps. */
function fitFor(frame: Frame, board: Board) {
  const { width, height } = board.box;
  const scale = Math.min(
    (width - PRESENT_MARGIN * 2) / frame.width,
    (height - PRESENT_MARGIN * 2) / frame.height,
  );
  return {
    scale,
    x: width / 2 - (frame.x + frame.width / 2) * scale,
    y: height / 2 - (frame.y + frame.height / 2) * scale,
  };
}

/** Where a frame's edges are on screen under `view`. */
function edges(frame: Frame, view: { x: number; y: number; scale: number }): number[] {
  return [
    frame.x * view.scale + view.x,
    frame.y * view.scale + view.y,
    (frame.x + frame.width) * view.scale + view.x,
    (frame.y + frame.height) * view.scale + view.y,
  ];
}

/** Waits for the flight to end, then says how far each of the frame's edges is from
 *  where the fit puts it, in screen pixels. */
async function landingError(board: Board, frame: Frame): Promise<number> {
  const want = edges(frame, fitFor(frame, board));
  let error = Infinity;
  await expect
    .poll(
      async () => {
        const got = edges(frame, await camera(board.page));
        error = Math.max(...got.map((edge, i) => Math.abs(edge - want[i]!)));
        return error;
      },
      { timeout: 5_000 },
    )
    .toBeLessThanOrEqual(1);
  return error;
}

interface Rendering {
  frames: number;
  p95CpuMs: number;
}

const rendering = (page: Page) =>
  page.evaluate(() => window.__drawEngine!.debugSnapshot().rendering as unknown as Rendering);

test("ten nested frames: the path is set in the editor, and each stop lands to the pixel in budget", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const board = await openBoard(page, "prezi", { scene: scene([CLOSE, ...PATH.slice(0, -1)]) });

  // The editor lists the frames as they were drawn: Close first.
  await openPathEditor(board);
  const drawn = [CLOSE, ...PATH.slice(0, -1)].map((frame) => frame.name);
  expect(await stopNames(page)).toEqual(drawn);
  await expect(page.locator(".path-badge")).toHaveCount(10);

  // A drag moves Close to the end.
  const rows = panel(page).locator("li");
  await rows.first().dragTo(rows.last());
  await expect.poll(() => stopNames(page)).toEqual(PATH.map((frame) => frame.name));
  const steps = new Map((await sceneElements(page)).map((el) => [el.id, el.pathStep]));
  expect(PATH.map((frame) => steps.get(frame.id))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  // Present from the editor, and walk the path.
  await panel(page).getByRole("button", { name: "Present", exact: true }).click();
  await expect(page.getByText("1 / 10")).toBeVisible();

  const worst = { landing: 0, p95: 0, frames: 0 };
  let lowest = Infinity;
  for (const [index, frame] of PATH.entries()) {
    if (index > 0) {
      const before = await rendering(page);
      if (frame.id === "scene2") {
        // Sample the zoom every frame of this flight, to see it pull back on the way.
        await page.evaluate(() => {
          const w = window as unknown as { __flightScales: number[] };
          w.__flightScales = [];
          const sample = () => {
            w.__flightScales.push(window.__drawEngine!.camera.scale);
            if (w.__flightScales.length < 240) requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });
      }
      await page.keyboard.press("ArrowRight");
      await expect(page.getByText(`${index + 1} / 10`)).toBeVisible();
      worst.landing = Math.max(worst.landing, await landingError(board, frame));
      const after = await rendering(page);
      worst.frames = Math.max(worst.frames, after.frames - before.frames);
      worst.p95 = Math.max(worst.p95, after.p95CpuMs);
      if (frame.id === "scene2") {
        // Detail 1 → Scene 2, siblings apart: the view pulls back past both on the way.
        const scales = await page.evaluate(
          () => (window as unknown as { __flightScales: number[] }).__flightScales,
        );
        lowest = Math.min(...scales);
        expect(lowest).toBeLessThan(fitFor(frame, board).scale * 0.9);
      }
    } else {
      worst.landing = Math.max(worst.landing, await landingError(board, frame));
    }
    if (index === 3 || index === 9) {
      await testInfo.attach(`stop ${index + 1} — ${frame.name}`, {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    }
  }

  console.log(
    `  10-stop path: worst landing ${worst.landing.toFixed(3)}px, worst p95 cpu ` +
      `${worst.p95.toFixed(2)}ms, up to ${worst.frames} frames a flight; ` +
      `Detail 1 → Scene 2 pulled back to ${lowest.toFixed(3)}x`,
  );
  expect(worst.landing).toBeLessThanOrEqual(1);
  expect(worst.p95).toBeLessThan(FRAME_BUDGET_MS);
});

test("Alt+↑/↓ and the arrow buttons move a stop, the focus goes with it, one undo each", async ({
  page,
}) => {
  const three = PATH.slice(1, 4);
  const board = await openBoard(page, "prezi", { scene: scene(three) });
  await openPathEditor(board);
  expect(await stopNames(page)).toEqual(["Act 1", "Scene 1", "Detail 1"]);
  await expect(panel(page).getByRole("button", { name: "Stop 1: Act 1" })).toBeFocused();

  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(() => stopNames(page)).toEqual(["Scene 1", "Act 1", "Detail 1"]);
  await expect(panel(page).getByRole("button", { name: "Stop 2: Act 1" })).toBeFocused();

  await panel(page).getByRole("button", { name: "Move Detail 1 earlier" }).click();
  await expect.poll(() => stopNames(page)).toEqual(["Scene 1", "Detail 1", "Act 1"]);

  await focusBoard(board);
  await page.keyboard.press("Control+z");
  await expect.poll(() => stopNames(page)).toEqual(["Scene 1", "Act 1", "Detail 1"]);

  // Escape closes it, and the numbers on the board go with it.
  await panel(page).getByRole("button", { name: "Stop 1: Scene 1" }).focus();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(page.locator(".path-badge")).toHaveCount(0);
});

test("B blanks the screen until the next key, W likewise in white, and 3 then Enter goes to slide 3", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const three = PATH.slice(5, 8);
  const board = await openBoard(page, "prezi", { scene: scene(three) });
  await focusBoard(board);
  await page.keyboard.press("Control+Alt+p");
  await expect(page.getByText("1 / 3")).toBeVisible();

  await page.keyboard.press("b");
  const blank = page.locator(".present-blank");
  await expect(blank).toBeVisible();
  await expect(blank).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await page.keyboard.press("ArrowRight");
  await expect(blank).toHaveCount(0);
  await expect(page.getByText("1 / 3"), "the key that unblanks does not also step").toBeVisible();

  await page.keyboard.press("w");
  await expect(blank).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.keyboard.press("w");
  await expect(blank).toHaveCount(0);

  await page.keyboard.press("3");
  await page.keyboard.press("Enter");
  await expect(page.getByText("3 / 3")).toBeVisible();
  await landingError(board, three[2]!);
});
