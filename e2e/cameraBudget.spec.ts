import { buildScene } from "../perf/scene.ts";
import { focusBoard, openBoard, wheelAt } from "./board.ts";
import { expect, test } from "./fixtures.ts";

/**
 * Panning and zooming a 2,000-element board stays inside a 60Hz frame.
 *
 * Held against our own CPU per frame — building the display list and issuing the drawing
 * (`debugSnapshot().rendering.p95CpuMs`) — never against the rAF interval: CI and the lab
 * machines rasterise through SwiftShader, where the interval measures the compositor
 * rather than the page (`perf/measure.ts`). `perf/` compares the same gestures against
 * Excalidraw; this is the budget the gate keeps.
 */

const FRAME_BUDGET_MS = 1000 / 60;

interface Rendering {
  frames: number;
  p95CpuMs: number;
  p95PaintMs: number;
  medianBuildMs: number;
  p95FrameMs: number;
  elementsRendered: number;
  redraws: number;
}

test("2,000 elements pan and zoom inside a 60Hz frame", async ({ page }) => {
  test.setTimeout(180_000);
  // The camera lands at once, so what is timed is the frames the wheel asks for.
  await page.emulateMedia({ reducedMotion: "reduce" });
  // A 40x50 grid of ordinary shapes, half of them hachure-filled.
  const board = await openBoard(page, "budget", { scene: buildScene(2000, "small") });
  await focusBoard(board);
  // Everything on screen at once, so culling cannot do the work for us.
  await page.keyboard.press("Shift+Digit1");
  const rendering = () =>
    page.evaluate(() => window.__drawEngine!.debugSnapshot().rendering as unknown as Rendering);
  await expect.poll(async () => (await rendering()).elementsRendered).toBe(2000);
  const middle = { x: board.box.width / 2, y: board.box.height / 2 };

  // The engine keeps the last 120 frames. Each phase asks for more than that, so the
  // window it is judged on holds its own frames only — never the first paint's.
  const phase = async (name: string, gesture: () => Promise<void>) => {
    const before = await rendering();
    await gesture();
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
    const after = await rendering();
    console.log(
      `  2,000 elements, ${name}: p95 cpu ${after.p95CpuMs.toFixed(2)}ms` +
        ` (p95 paint ${after.p95PaintMs.toFixed(2)}ms, median build ${after.medianBuildMs.toFixed(2)}ms)` +
        ` over ${after.frames - before.frames} frames, ${after.elementsRendered} drawn;` +
        ` p95 interval ${after.p95FrameMs.toFixed(1)}ms, ${after.redraws - before.redraws} repainted in full`,
    );
    expect(after.frames - before.frames).toBeGreaterThanOrEqual(120);
    return after;
  };

  // Back and forth, so every element stays on screen throughout.
  const pan = await phase("pan", async () => {
    for (let i = 0; i < 150; i += 1) {
      const way = i % 20 < 10 ? 1 : -1;
      await wheelAt(board, middle, { x: 14 * way, y: 9 * way });
    }
  });
  expect(pan.elementsRendered).toBe(2000);
  expect(pan.p95CpuMs).toBeLessThan(FRAME_BUDGET_MS);

  // In to about 1.7x and back out to everything.
  const zoom = await phase("zoom", async () => {
    for (let i = 0; i < 75; i += 1) await wheelAt(board, middle, { y: -40 }, { ctrl: true });
    for (let i = 0; i < 75; i += 1) await wheelAt(board, middle, { y: 40 }, { ctrl: true });
  });
  expect(zoom.elementsRendered).toBe(2000);
  expect(zoom.p95CpuMs).toBeLessThan(FRAME_BUDGET_MS);
});
