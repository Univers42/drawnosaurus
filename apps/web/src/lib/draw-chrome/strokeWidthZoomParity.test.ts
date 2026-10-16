import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { worldToScreen } from "@osionos/draw-engine/cameraMath";

/**
 * Issue #6 — "make the thickness of the pen scalable multiplying the thickness of it with the
 * percentage of zoom" — is **already how the engine paints**. This file is what stops that from
 * being "fixed" a second time.
 *
 * The mechanism, which took reading the engine to be sure of: `paint.rs` builds one view matrix
 * per frame out of the device pixel ratio and `camera.scale` (`dpr * s`, `paint.rs:1077`), hands
 * it to the context with a single `setTransform` (`with_element_transform`, `paint.rs:379`), and
 * then sets the line width from the element's own **scene-unit** `stroke_width`
 * (`paint.rs:283` for the stroke path, `:1825` for the linear one). A canvas line width is
 * transformed like any other length, so what reaches the screen is
 * `stroke_width × dpr × camera.scale` — the thickness **is** multiplied by the zoom. Zoom to 8×
 * and a width-1 line is 8× as thick on screen.
 *
 * So there is no feature to add, and the pull request that would add one has to add a
 * *divider* instead. That is the risk this file exists for. The tempting reading of "make the
 * thickness scale with zoom" is `stroke_width / camera.scale` — keep the line the same thickness
 * on screen at every zoom, which is what a "fixed pen" would do. That change is invisible in a
 * diff, passes every existing test (nothing relates the two), and silently breaks parity: the
 * oracle's width is a world measurement, and `docs/reference/rendering.md` measures the
 * consequence directly, in `pathCacheMisses` and `shapeCacheMisses` going flat across a camera
 * change.
 *
 * The engine already draws the distinction this has to keep, and it is worth naming because it
 * is easy to invert by accident:
 *
 * | what                                   | units     | zoom            | where      |
 * | -------------------------------------- | --------- | --------------- | ---------- |
 * | the element's own stroke               | scene     | **multiplies**  | `:283`     |
 * | the trace overlay's outline            | screen px | divides back    | `:2345`    |
 * | the binding highlight's outline        | screen px | divides back    | `:2515`    |
 *
 * The bottom two take a width the caller states in **screen** pixels, so inside the element's
 * transformed space they divide it back out — `width_px / s`, with the comment
 * "In the element's own units, where one CSS pixel is `1 / scale`" (`:2344`). They are chrome:
 * a hand affordance, which `.claude/skills/frontend-reverse-engineering/references/
 * interaction-model.md` puts in screen pixels on purpose. The top one is geometry and does not
 * divide. A guard that only looked for the division would pass on the two chrome paths that
 * legitimately have one, so both halves are asserted here.
 *
 * The structural half follows `cameraParity.test.ts` in the same directory: read the engine's
 * Rust and hold the numbers to what it says. The behavioural half of this — that a width really
 * does land thicker on screen at a higher zoom — is a pixel measurement and belongs in
 * `e2e/zoom.spec.ts`, which already owns `shownZoomPercent` and the ink probes. This file cannot
 * measure pixels: vitest runs the WASM in `environment: "node"` (`apps/web/vite.config.ts`) with
 * no canvas, which is the same reason `trace_outlines` and the binding highlight are unreachable
 * from a unit test at all.
 *
 * **What this does and does not prove.** The WASM case below is the part with teeth in this
 * file: it calls the engine and shows `camera.scale` is a real multiplier on a world length, so
 * "the transform scales the line" is not an assumption about how canvas works. It does **not**
 * observe a painted pixel — nothing here can. If someone wants that evidence rather than this
 * argument, the honest form is an e2e spec that strokes a horizontal line at 1× and at 8× and
 * compares ink thickness, and that is a bigger ask than this issue.
 */

const REPO_ROOT = new URL("../../../../../", import.meta.url);

/** `paint.rs` — the one file where both halves of the distinction are written down. */
const PAINT_RS = new URL("engine/crates/draw-engine/src/wasm/paint.rs", REPO_ROOT);

/**
 * The two places an element's own stroke reaches the context, and the two where chrome does.
 *
 * Pinned by **shape, not by line**. A doc comment inserted above either call moves it, and the
 * only thing such a move should cost is nothing — so unlike `cameraParity.test.ts`, which pins
 * by line because `docs/reference/camera.md` cites those lines, this one matches the expression
 * wherever it lands. What matters is that a width divided by the zoom is somewhere it is not.
 */
const STROKE_SITES = [
  { what: "the stroke path", pattern: /set_line_width_cached\(ctx, element\.stroke_width\)/ },
  { what: "the linear path", pattern: /set_line_width_cached\(ctx, element\.stroke_width\)/ },
] as const;

/** Chrome that states its width in screen pixels and must keep dividing it back out. */
const CHROME_SITES = [
  { what: "the trace overlay", pattern: /set_line_width\(width_px\s*\/\s*s\.max\(/ },
  { what: "the binding highlight", pattern: /set_line_width\(element\.stroke_width\.clamp\(/ },
] as const;

/**
 * What a "helpful fix" for issue #6 looks like, so the guard can be shown to catch it.
 *
 * **This is the load-bearing part of the file.** A guard that has never been seen to fail is a
 * guard nobody knows the reach of, and the defect it is aimed at is precisely the kind that looks
 * correct in review. Each of these is a line someone would plausibly write after reading the
 * issue; every one of them has to be caught, which is asserted below rather than assumed.
 */
const WRONG_FIXES: ReadonlyArray<{ what: string; line: string }> = [
  {
    what: "the stroke divided by the zoom",
    line: "set_line_width_cached(ctx, element.stroke_width / camera.scale);",
  },
  {
    what: "the stroke normalised by the camera",
    line: "let k = 1.0 / view.camera.scale; set_line_width_cached(ctx, element.stroke_width * k);",
  },
  {
    what: "the stroke hoisted through a scale-1 context",
    line: "let _ = ctx.set_transform(1.0, 0.0, 0.0, 1.0, 0.0, 0.0);\nset_line_width_cached(ctx, element.stroke_width);",
  },
  {
    what: "the view matrix with the zoom dropped",
    line: "let view_transform = [dpr, 0.0, 0.0, dpr, dpr * view.camera.x, dpr * view.camera.y];",
  },
];

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** A file's text, or `""` when it is not there — see `cameraParity.test.ts` for why. */
function sourceOf(url: URL): string {
  try {
    return readFileSync(url, "utf8");
  } catch {
    return "";
  }
}

/**
 * True when an element's stroke width is set from anything but its own scene-unit value.
 *
 * Read over a **window**, not a line, and that is the second thing this guard got wrong first:
 * a transform hoisted onto its own line above the call —
 * `ctx.set_transform(1.0, …)` then `set_line_width_cached(ctx, element.stroke_width)` — leaves
 * the width argument perfectly clean, so a line-at-a-time scan reports the engine as fine while
 * the zoom has been thrown away. Both mistakes were found by patching the engine and watching
 * this file stay green; the two-line window is what closes the second, and `WINDOW` is the
 * number the next one would have to raise.
 *
 * Three shapes, and the third is the cheapest to write by accident — hoisting a stroke out of
 * the camera loop to paint it "in screen space" reads as tidying, and it is exactly the change
 * issue #6 invites:
 *
 * 1. the width carries the zoom — `stroke_width / camera.scale`, `* s`;
 * 2. the reciprocal hoisted, so the zoom is one local away — `let k = 1.0 / scale;` (the shape
 *    `cameraParity.test.ts` already matches for the deleted camera mirror);
 * 3. the width set under a scale-1 transform, so the camera never reaches it.
 */
const WINDOW = 2;

/** Lines either side of a call that could have changed what that call means. */
function around(lines: string[], index: number): string {
  return lines.slice(Math.max(0, index - WINDOW), index + 1).join("\n");
}

function takesTheZoomOffTheStroke(context: string): boolean {
  if (!/set_line_width\w*\(\s*ctx\s*,\s*[^)]*stroke_width/.test(context)) return false;
  const width = /set_line_width\w*\(([^;]*)\)/.exec(context)?.[1] ?? "";
  // The width itself carries the zoom.
  if (/scale|\*\s*s\b|\/\s*[^;)]*\bs\b/.test(width)) return true;
  // The reciprocal was hoisted, so the zoom is one local away rather than one operator.
  if (/=\s*1(?:\.0+)?\s*\/\s*[\w.]*scale/.test(context)) return true;
  // Painted outside the camera entirely.
  if (/set_transform\(\s*1(?:\.0+)?\s*,\s*0\.0/.test(context)) return true;
  return false;
}

/**
 * The lines that would take the zoom off a stroke, as `line: text` so a failure names itself.
 *
 * Every call site in the engine is reported, not the first one, so a partial revert cannot hide
 * behind a match elsewhere in the file.
 */
function strokeZoomOffenders(source: string): string[] {
  const lines = source.split("\n");
  const found: string[] = [];
  lines.forEach((line, index) => {
    if (
      /set_line_width\w*\(\s*ctx\s*,\s*[^)]*stroke_width/.test(line) &&
      takesTheZoomOffTheStroke(around(lines, index))
    ) {
      found.push(`${index + 1}: ${line.trim()}`);
    }
  });
  return found;
}

describe("issue #6 — the pen already thickens with the zoom", () => {
  const paint = withoutComments(sourceOf(PAINT_RS));

  it("found the engine source it is here to check", () => {
    expect(
      paint,
      "engine/crates/draw-engine/src/wasm/paint.rs should exist: it is where both halves of the " +
        "world-units/screen-pixels distinction are written, and neither is reachable from here " +
        "without it",
    ).not.toBe("");
  });

  it("folds camera.scale into the view matrix, so the context scales every length it sets", () => {
    // `dpr * s` on both diagonals of the matrix `with_element_transform` hands to `setTransform`.
    // Without the `* s` the context would be at zoom 1 and nothing on the board would scale —
    // including the line width, which is the whole of issue #6.
    expect(paint, "the view matrix should carry dpr * s").toMatch(/let s = view\.camera\.scale/);
    expect(paint, "the view matrix should carry dpr * s on both diagonals").toMatch(
      /view_transform = \[\s*dpr \* s,\s*0\.0,\s*0\.0,\s*dpr \* s,/,
    );
  });

  it("sets an element's stroke width from its own scene-unit value, undivided", () => {
    // The assertion the issue would break. A width that arrives already divided would make every
    // line the same thickness on screen at every zoom, which is the opposite of #6 and a
    // departure from the oracle, whose width is a world measurement.
    for (const { what } of STROKE_SITES) {
      expect(paint, `paint.rs should set ${what} from element.stroke_width`).toMatch(
        /set_line_width_cached\(ctx, element\.stroke_width\)/,
      );
    }
    const offenders = strokeZoomOffenders(paint);
    expect(
      offenders,
      "no line may set an element's stroke width from the zoom. The thickness of a drawn line is " +
        "a world measurement and scales with the camera — that is issue #6, and it already " +
        "happens. Chrome that wants a screen-pixel width divides it back out at its own site " +
        "(width_px / s), not here.",
    ).toEqual([]);
  });

  it("still lets the two screen-pixel chrome paths divide it back out", () => {
    // Both halves, because a guard written as "the zoom must never divide a line width" would
    // fail on these two — and the right response to that failure would be to delete the guard,
    // which is how the real one gets lost.
    for (const { what, pattern } of CHROME_SITES) {
      expect(paint, `paint.rs should keep ${what} constant in screen pixels`).toMatch(pattern);
    }
  });
});

describe("the guard this file rests on can actually fail", () => {
  it.each(WRONG_FIXES)("catches $what", ({ line }) => {
    expect(
      line,
      "this case no longer describes a mistake; rewrite it or drop it. Note that the last one " +
        "is caught by the view-matrix assertion above rather than by this guard, which is why " +
        "both halves exist.",
    ).toSatisfy(
      (candidate: string) =>
        takesTheZoomOffTheStroke(candidate) || /view_transform = \[\s*dpr,/.test(candidate),
    );
  });

  it("does not flag the code that is actually there", () => {
    // The other direction, and the one that decides whether the guard is usable: applied to the
    // engine's real lines, `takesTheZoomOffTheStroke` must find nothing. A guard that fires on the correct
    // code cries wolf and gets switched off.
    const paint = withoutComments(sourceOf(PAINT_RS));
    expect(strokeZoomOffenders(paint)).toEqual([]);
  });
});

describe("the zoom is a real multiplier on a world length", () => {
  it("moves a world point further on screen at a higher scale, and back exactly", () => {
    // The behavioural half that *is* reachable from a unit test. It cannot observe a painted
    // pixel — there is no canvas in `environment: "node"` — but it does show that
    // `camera.scale` enters the transform as the multiplier the argument above depends on, and
    // that it does so through the engine rather than through a host-side expression.
    const point = { x: 100, y: 40 };

    for (const scale of [1, 2, 8, 0.25]) {
      const camera = { x: 0, y: 0, scale };
      const at = worldToScreen(camera, point.x, point.y);
      expect(at.x).toBeCloseTo(point.x * scale, 9);
      expect(at.y).toBeCloseTo(point.y * scale, 9);
    }
  });

  it("holds at 8× what it holds at 1×, for the same world length", () => {
    // Spelled out because it is the claim the whole file rests on: eight times the zoom, eight
    // times the on-screen length. If `worldToScreen` ever stopped being a plain multiply — a
    // zoom-dependent curve, a clamp, a fitted offset — this is what would notice first.
    const world = 10;
    const at1 = worldToScreen({ x: 0, y: 0, scale: 1 }, world, 0);
    const at8 = worldToScreen({ x: 0, y: 0, scale: 8 }, world, 0);
    expect(at1.x * 8).toBeCloseTo(at8.x, 9);
  });
});
