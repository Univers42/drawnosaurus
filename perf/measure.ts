import type { Page } from "@playwright/test";

/**
 * How the two editors are actually compared.
 *
 * Not by frame rate. This machine has no `/dev/dri`, so the browser rasterises through
 * SwiftShader on the CPU, and under SwiftShader `requestAnimationFrame` pacing tells you
 * about the compositor rather than about the page — a 1013ms interval measured here once
 * turned out to be compositing, not a stall. Any number derived from rAF would be
 * measuring the wrong machine.
 *
 * What is measured instead is **main-thread task time**, read from the Chrome DevTools
 * Protocol's `Performance` domain. `TaskDuration` is the total time the main thread spent
 * in tasks; it is what "snappy" means, it is immune to compositor pacing, and both
 * editors are charged for it on identical terms.
 */

export interface Sample {
  /** Seconds of main-thread task time spent during the scenario. */
  taskDuration: number;
  /** Of which, seconds spent executing script. */
  scriptDuration: number;
  /** Seconds spent in layout. */
  layoutDuration: number;
  /** Wall-clock milliseconds, as a sanity check on the above. */
  wallMs: number;
}

interface Counters {
  taskDuration: number;
  scriptDuration: number;
  layoutDuration: number;
}

export interface Meter {
  read(): Promise<Counters>;
  detach(): Promise<void>;
}

/** Opens a CDP session and enables the performance counters. */
export async function meter(page: Page): Promise<Meter> {
  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  return {
    async read() {
      const { metrics } = await client.send("Performance.getMetrics");
      const of = (name: string) => metrics.find((m) => m.name === name)?.value ?? 0;
      return {
        taskDuration: of("TaskDuration"),
        scriptDuration: of("ScriptDuration"),
        layoutDuration: of("LayoutDuration"),
      };
    },
    async detach() {
      await client.detach();
    },
  };
}

/** Runs `scenario` once and charges it whatever the main thread spent. */
export async function sample(m: Meter, scenario: () => Promise<void>): Promise<Sample> {
  const before = await m.read();
  const started = Date.now();
  await scenario();
  const wallMs = Date.now() - started;
  const after = await m.read();
  return {
    taskDuration: after.taskDuration - before.taskDuration,
    scriptDuration: after.scriptDuration - before.scriptDuration,
    layoutDuration: after.layoutDuration - before.layoutDuration,
    wallMs,
  };
}

/** The middle value, which is what a handful of noisy runs can honestly report. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export interface Result {
  taskMs: number;
  scriptMs: number;
  layoutMs: number;
  wallMs: number;
}

/** Medians across repetitions, in milliseconds. */
export function summarise(samples: Sample[]): Result {
  return {
    taskMs: median(samples.map((s) => s.taskDuration)) * 1000,
    scriptMs: median(samples.map((s) => s.scriptDuration)) * 1000,
    layoutMs: median(samples.map((s) => s.layoutDuration)) * 1000,
    wallMs: median(samples.map((s) => s.wallMs)),
  };
}

/** The gestures, measured apart so a total cannot hide which one is expensive. */
export type Gesture = "pan" | "zoom" | "drag";

export const GESTURES: Gesture[] = ["pan", "zoom", "drag"];

/**
 * One scripted gesture, given to both editors identically.
 *
 * Wheel events rather than synthesised ones, so each editor's own handler decides what a
 * delta is worth — that decision is part of what is being compared. The pointer stays
 * over the middle of the canvas throughout, well clear of either app's chrome.
 *
 * Separated by gesture because they stress different things and a single total says only
 * that something is slow. A pan moves every element without changing any of them, so a
 * cached raster stays valid; a zoom changes every element's size on screen, so a renderer
 * that rasterises per element has to decide whether to redo that work or accept a
 * stretched bitmap. That decision is most of what is being measured here.
 */
export function stressScenario(page: Page, centre: { x: number; y: number }, gesture: Gesture) {
  return async () => {
    await page.mouse.move(centre.x, centre.y);
    if (gesture === "pan") {
      for (let i = 0; i < 30; i += 1) {
        await page.mouse.wheel(20, 30);
      }
      return;
    }
    if (gesture === "zoom") {
      await page.keyboard.down("Control");
      for (let i = 0; i < 10; i += 1) {
        await page.mouse.wheel(0, -100);
      }
      for (let i = 0; i < 10; i += 1) {
        await page.mouse.wheel(0, 100);
      }
      await page.keyboard.up("Control");
      return;
    }
    await page.mouse.down();
    for (let i = 1; i <= 20; i += 1) {
      await page.mouse.move(centre.x + i * 8, centre.y + i * 4);
    }
    await page.mouse.up();
  };
}

/** The renderer the browser is actually using, recorded with every report. */
export async function rendererName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return "no webgl";
    const info = (gl as WebGLRenderingContext).getExtension("WEBGL_debug_renderer_info");
    if (!info) return (gl as WebGLRenderingContext).getParameter(0x1f01) as string;
    return (gl as WebGLRenderingContext).getParameter(
      (info as { UNMASKED_RENDERER_WEBGL: number }).UNMASKED_RENDERER_WEBGL,
    ) as string;
  });
}
