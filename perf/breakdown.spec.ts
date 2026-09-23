import { test } from "@playwright/test";
import { meter, sample, summarise } from "./measure.ts";
import { buildScene } from "./scene.ts";

/**
 * Where our own time goes, measured rather than argued about.
 *
 * `parity.spec.ts` says we lose to Excalidraw on one thing: panning a board of
 * screen-sized shapes. This file is how that was narrowed down, and it is kept because it
 * is also how a fix will be checked.
 *
 * It varies one property of the same scene at a time. What it found, on 300 shapes of
 * 1100x640 at the time of writing:
 *
 *   hachure fill   2682ms
 *   solid fill      759ms
 *   no fill         625ms
 *
 * So roughly three quarters of the cost is the pattern fill, and script time is flat at
 * ~33ms across all three — it is not the engine deciding what to draw, it is Canvas2D
 * stroking it. A hachure fill of a shape that size is some eighty double-stroked lines,
 * and we re-stroke every one of them, for every visible element, on every frame.
 *
 * The fix that follows from this is an element bitmap cache: rasterise a shape once and
 * blit it afterwards, which is what Excalidraw does and why its pan is cheaper. Since the
 * shape cache is already keyed by geometry rather than by element, duplicates would share
 * one bitmap as they now share one path.
 */

const OURS = process.env.PERF_OURS ?? "http://127.0.0.1:4374";

for (const fill of ["hachure", "solid", "none"] as const) {
  test(`pan with ${fill} fill`, async ({ page }) => {
    test.setTimeout(180_000);
    const elements = buildScene(300, "big").map((e) => ({
      ...e,
      fillStyle: fill === "none" ? "hachure" : fill,
      backgroundColor: fill === "none" ? "transparent" : "#ffec99",
    }));
    await page.routeWebSocket(/\/(live|ws)$/, () => {});
    await page.route("**/v1/**", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          slug: "perf",
          title: "perf",
          scene: { type: "osidraw", version: 1, source: "perf", elements },
        }),
      });
    });
    await page.goto(`${OURS}/boards/perf`);
    await page.waitForFunction(() => window.__drawEngine !== undefined);
    await page.waitForLoadState("networkidle");

    const m = await meter(page);
    const run = (events: number, dx: number, dy: number) => async () => {
      await page.mouse.move(640, 400);
      for (let i = 0; i < events; i += 1) await page.mouse.wheel(dx, dy);
    };
    for (const [events, dx, dy] of [[30, 20, 30]] as const) {
      const samples = [];
      for (let i = 0; i < 4; i += 1) {
        const s = await sample(m, run(events, dx, dy));
        if (i > 0) samples.push(s);
      }
      const r = summarise(samples);
      const plans = await page.evaluate(() =>
        (window.__drawEngine as unknown as { paintStats(): Record<string, number> }).paintStats(),
      );
      console.log(
        `  fill=${fill.padEnd(8)} task ${r.taskMs.toFixed(0)}ms  script ${r.scriptMs.toFixed(1)}ms  plans ${JSON.stringify(plans)}`,
      );
    }
    await m.detach();
  });
}
