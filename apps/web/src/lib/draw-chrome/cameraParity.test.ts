import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The engine's camera maths against the host's TypeScript.
 *
 * `engine/src/camera.ts` used to be a hand-kept mirror of `camera.rs`: the same
 * `world_to_screen`, the same `screen_to_world`, the same 0.1 and 30 written out again in
 * `engine/src/types.ts`. The front imported the mirror, so every pixel of chrome it placed
 * came from a copy of the engine's arithmetic that **no test compared to the engine** — the
 * one thing BUNNY.md §2's sanctioned-mirror rule asks for, and the copy that drifted for a
 * year without a single failure.
 *
 * Those four values are WASM exports now (`#[wasm_bindgen]`, `src/wasm/camera_api.rs`), the
 * mirror is deleted, and this is what holds the two sides together. It reads the engine's
 * Rust and then goes looking for the expressions in the host's own source — `.ts` **and
 * `.svelte`**, since every consumer of these functions is a Svelte component and p2.2a
 * took a hand-written `screen_to_world` out of `DrawSurface.svelte` itself. So:
 *
 * - a hand-written `world_to_screen` or `screen_to_world` reappearing in any of them
 *   fails here, and the failure names the file and line. Both commutations of each sum
 *   are matched, and a hoisted `1 / c.scale` is matched too, so reordering the
 *   arithmetic does not get it past;
 * - `MIN_ZOOM`/`MAX_ZOOM` reappearing **under those names** as their own literals fails
 *   here. That one is name-anchored and cannot be otherwise: see `EXPRESSIONS`, and the
 *   known limit below.
 * - the four Rust values moving fails here, and the message says where they went.
 *
 * **Known limit, so nobody has to find it the hard way:** a copy that renames its
 * constants *and* is written as an object literal rather than an assignment — `const low
 * = { min: 0.1, max: 30 }` — is not caught. The two transforms are caught by their shape;
 * the two limits are only catchable by their name, and a name-blind search for `0.1` and
 * `30` would match most of the tree. If that matters, it wants a real test on the
 * numbers' meaning, not a wider regex.
 *
 * The arithmetic itself is pinned as behaviour in
 * `engine/crates/draw-engine/tests/ci_camera.rs`; this is the structural half — that the
 * engine is the only place it is written.
 *
 * Follows the pattern of `packages/contract/tests/engineParity.test.ts`: read the engine's
 * source, hold the TypeScript side to what it says.
 */

const REPO_ROOT = new URL("../../../../../", import.meta.url);

/** `camera.rs` — where the four values are written down. */
const CAMERA_RS = new URL("engine/crates/draw-engine/src/camera.rs", REPO_ROOT);

/** `src/wasm/camera_api.rs` — the bindings that hand them to the host. */
const CAMERA_API_RS = new URL("engine/crates/draw-engine/src/wasm/camera_api.rs", REPO_ROOT);

/** The host's wrapper, which must call WASM rather than compute. */
const CAMERA_MATH_TS = new URL("engine/src/cameraMath.ts", REPO_ROOT);

/** The two roots of shipped TypeScript: the engine's host layer, and the app. */
const TS_ROOTS = ["engine/src", "apps/web/src"] as const;

/** Where the four live, pinned. A move is a deliberate edit to this file, not a surprise. */
const PINNED: ReadonlyArray<{ what: string; pattern: RegExp; line: number }> = [
  { what: "MIN_ZOOM", pattern: /^pub const MIN_ZOOM: f64 = /, line: 5 },
  { what: "MAX_ZOOM", pattern: /^pub const MAX_ZOOM: f64 = /, line: 6 },
  { what: "world_to_screen", pattern: /^pub fn world_to_screen\(/, line: 147 },
  { what: "screen_to_world", pattern: /^pub fn screen_to_world\(/, line: 154 },
];

/** The four names the host is given, and the Rust each one comes from. */
const BINDINGS: ReadonlyArray<{ js: string; rust: string }> = [
  { js: "worldToScreen", rust: "crate::camera::world_to_screen" },
  { js: "screenToWorld", rust: "crate::camera::screen_to_world" },
  { js: "minZoom", rust: "crate::camera::MIN_ZOOM" },
  { js: "maxZoom", rust: "crate::camera::MAX_ZOOM" },
];

/**
 * The shapes a copy of each expression takes, as they appear in TypeScript.
 *
 * Matched on the arithmetic rather than on a name, so renaming the locals — which is what
 * the deleted mirror did, returning `{sx, sy}` where the engine returns `x`/`y` — does not
 * hide it.
 */
const EXPRESSIONS: ReadonlyArray<{ what: string; pattern: RegExp }> = [
  // `wx * camera.scale + camera.x`, and its y twin.
  { what: "world_to_screen", pattern: /\*\s*[\w.]+\.scale\s*\+/ },
  // The same sum with the camera's own coordinate written first, which is the other
  // half of the commutation. Both addends are required, and specifically the camera
  // coordinate as one of them: `y + 18 * camera.scale` in `shapeSwitch.ts` is a chrome
  // nudge off a world point and nothing to do with this formula, and matching on the
  // multiply alone would flag it.
  { what: "world_to_screen", pattern: /[\w.]+\.[xy]\s*\+\s*[\w.]+\s*\*\s*[\w.]+\.scale/ },
  // `(sx - camera.x) / camera.scale`, and its y twin.
  { what: "screen_to_world", pattern: /\(\s*[\w.]+\s*-\s*[\w.]+\.x\s*\)\s*\/\s*[\w.]+\.scale/ },
  // The same quotient with the division hoisted into a local: `const k = 1 / c.scale`,
  // then `(sx - c.x) * k`.
  { what: "screen_to_world", pattern: /=\s*1\s*\/\s*[\w.]+\.scale\b/ },
  // The two limits, written out rather than asked for. **Name-anchored, and that is a
  // real limit rather than an oversight**: a transform is recognisable by its shape, but
  // "0.1 and 30" only mean the zoom limits next to a name that says so. Searching for
  // the bare numbers would flag every `0.1` and every `30` in the tree, which is a guard
  // that cries wolf and gets deleted. So renaming `MIN_ZOOM` escapes this, and only
  // this — see "known limit" in the report.
  { what: "MIN_ZOOM", pattern: /MIN_ZOOM\s*=\s*0\.1\b/ },
  { what: "MAX_ZOOM", pattern: /MAX_ZOOM\s*=\s*30\b/ },
];

/** Comments dropped: a test that trips over prose about a deleted copy is noise. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * A file's text, or `""` when it is not there.
 *
 * Without this a file that has not been written yet takes the whole suite down at
 * collection time, and the one thing the reader learns is an `ENOENT` — rather than which
 * of the four expectations the change was supposed to satisfy.
 */
function sourceOf(url: URL): string {
  try {
    return readFileSync(url, "utf8");
  } catch {
    return "";
  }
}

/**
 * Every shipped source file under `dir`, comments removed, split into lines.
 *
 * **`.svelte` is scanned and `.test.ts` is not, and the difference is load-bearing.**
 * All four consumers of these functions are Svelte components — `DrawSurface.svelte`,
 * `PeerCursors.svelte`, `shapeSwitch.ts` beside them — and p2.2a took a hand-written
 * `screen_to_world` out of `DrawSurface.svelte` itself, so a `.ts`-only scan left the
 * one file type where the mirror actually lived unwatched. `.ts` alone is not enough.
 *
 * Test files are the other side of it, and the exclusion is **already load-bearing, not
 * hypothetical**: `apps/web/src/lib/draw-chrome/camera.test.ts:423` asserts
 * `centerX * camera.scale + camera.x` to check where `focusCamera` puts a shape, which is
 * the shape of the very expression this file hunts. Widening the scan to test files turns
 * that assertion — and `bunny-p2.g2-bounds-normalise`'s, which asserts the same thing
 * under its own name — into a false positive, and a guard that cries wolf is a guard that
 * gets switched off. So do not "helpfully" drop the `\.test\.ts$` exclusion. The
 * `it("has files to check")` case below is what notices if the scan quietly stops seeing
 * anything.
 */
function shippedSourceLines(dir: URL): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const walk = (url: URL): void => {
    for (const entry of readdirSync(url, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, url);
      if (entry.isDirectory()) walk(child);
      else if (/\.(ts|svelte)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
        found.set(fileURLToPath(child), withoutComments(readFileSync(child, "utf8")).split("\n"));
      }
    }
  };
  walk(dir);
  return found;
}

/** The 1-based line of the first line matching `pattern`, or `undefined`. */
function lineOf(lines: string[], pattern: RegExp): number | undefined {
  const index = lines.findIndex((line) => pattern.test(line));
  return index < 0 ? undefined : index + 1;
}

describe("the engine's camera maths", () => {
  const cameraRs = readFileSync(CAMERA_RS, "utf8").split("\n");

  it("still holds the four values where this says it does", () => {
    // A doc comment added above a function moves its line, which is the one change here
    // that needs no thought and so is worth a failure: the line is cited in
    // `docs/reference/camera.md` and in `engine/src/cameraMath.ts`.
    for (const { what, pattern, line } of PINNED) {
      const found = lineOf(cameraRs, pattern);
      expect(
        found,
        `camera.rs should declare ${what} on line ${line}, found it on line ${found ?? "none"}`,
      ).toBe(line);
    }
  });

  it("binds all four to WASM, each forwarding to the function above rather than computing", () => {
    const api = sourceOf(CAMERA_API_RS);
    expect(api, "src/wasm/camera_api.rs should exist: the four values have no binding").not.toBe(
      "",
    );
    for (const { js, rust } of BINDINGS) {
      expect(api, `camera_api.rs should bind ${js}`).toContain(`js_name = ${js}`);
      expect(api, `${js} should call ${rust}`).toContain(rust);
    }
    // The binding may not grow arithmetic of its own: every `=` in it belongs to a
    // signature, a `js_name`, or the destructuring of the answer.
    for (const line of withoutComments(api).split("\n")) {
      if (/fn |js_name|^\s*(use|\)|\})/.test(line)) continue;
      expect(line, "camera_api.rs computes something of its own").not.toMatch(/[*/+]\s*=/);
    }
  });
});

describe("the host's TypeScript", () => {
  const shipped = new Map(
    // The trailing slash matters: `new URL("camera.ts", "…/engine/src")` resolves
    // `src` as a file and lands in `…/engine/camera.ts`.
    TS_ROOTS.flatMap((root) => [...shippedSourceLines(new URL(`${root}/`, REPO_ROOT))]),
  );

  it("has files to check, and sees the Svelte components — so a `.ts`-only scan cannot pass this", () => {
    const paths = [...shipped.keys()];
    expect(paths.length).toBeGreaterThan(50);
    expect(paths.some((path) => path.includes("/engine/src/"))).toBe(true);
    expect(paths.some((path) => path.includes("/apps/web/src/"))).toBe(true);
    // The four consumers of these functions are Svelte components. A scan that stopped
    // at `.ts` would sail past a hand-written copy in any of them, and this file's own
    // header says it looks in "shipped TypeScript" as though `.svelte` were included.
    const svelte = paths.filter((path) => path.endsWith(".svelte"));
    expect(svelte.length).toBeGreaterThan(10);
    expect(svelte.some((path) => path.endsWith("draw-chrome/DrawSurface.svelte"))).toBe(true);
  });

  it("carries no hand-written copy of the engine's camera expressions", () => {
    const found: string[] = [];
    for (const [path, lines] of shipped) {
      lines.forEach((line, index) => {
        for (const { what, pattern } of EXPRESSIONS) {
          if (pattern.test(line)) found.push(`${path}:${index + 1} — a hand-written ${what}`);
        }
      });
    }
    expect(
      found,
      "the front must call the engine, not restate it (BUNNY.md §2). See engine/src/cameraMath.ts.",
    ).toEqual([]);
  });

  it("has no camera.ts mirror left to drift", () => {
    expect(readdirSync(new URL("engine/src/", REPO_ROOT))).not.toContain("camera.ts");
  });
});

describe("the wrapper the front calls", () => {
  const wrapper = sourceOf(CAMERA_MATH_TS);

  it("exists, and reaches all four through the generated glue without computing", () => {
    expect(wrapper, "engine/src/cameraMath.ts should exist").not.toBe("");
    expect(wrapper).toContain('from "../pkg/draw_engine.js"');
    for (const { js } of BINDINGS) {
      expect(wrapper, `cameraMath.ts should forward ${js} to WASM`).toContain(js);
    }
    for (const { what, pattern } of EXPRESSIONS) {
      expect(withoutComments(wrapper), `cameraMath.ts re-implements ${what}`).not.toMatch(pattern);
    }
  });
});
