import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The whole-scene PNG export's arithmetic, and the front's freedom from it.
 *
 * An export is the engine's: the box the scene is cut to, the size that box comes out at
 * for a chosen scale, and whether there is a background are four numbers that used to be
 * nobody's job — the dialog showed a scale picker and a transparent toggle, and the button
 * underneath encoded `canvas.toBlob()` of whatever was on screen, so both controls were
 * decoration. The engine answers all four now (`crates/draw-engine/src/export/png.rs`,
 * ported from `exportToCanvas`, `packages/excalidraw/scene/export.ts@1118751f:180-284`), and
 * the numbers themselves are pinned as behaviour in `ci_export_png.rs`.
 *
 * **What this file is for is the other half: making sure the front does not grow them
 * back.** A copy of the export's sizing in TypeScript is the one way this task could
 * quietly become two truths — the engine's and the front's — which is exactly the mirror
 * `cameraParity.test.ts` exists to prevent for the camera. So it reads the engine's Rust
 * for the numbers and then goes looking for them in `apps/web/src`, `.svelte` included,
 * because the only file that should mention an export at all is a Svelte component.
 *
 * Four parts, and they are not equally strong, so:
 *
 * - **the path-anchored check is the load-bearing one.** Every call to `exportPng` must be a
 *   forward: no arithmetic, no canvas, no device pixel ratio. That cannot false-positive,
 *   because a line naming the export and multiplying something is wrong whatever it was
 *   going to multiply.
 * - **it reads a window, not a line**, and it has to: a mutation that hoisted the copy one
 *   line up — `const chosen = scale * 2;` then `exportPng({ scale: chosen })` — passed a
 *   single-statement scan with all nine tests green. So each call is checked together with
 *   the statement before it, and a copy three lines up is still missed; that limit is the
 *   tree-wide check's job and is written down there.
 * - **it scans the engine's own TS host too**, because the host is TypeScript and the
 *   arithmetic is just as much a second truth there. A private `deviceRatio()` method next
 *   to `exportPng` was green before this: the host was checked at one line of one file.
 * - **the tree-wide checks are narrow**, and each says what it does and does not catch. A
 *   pattern that only recognises one spelling of the arithmetic is a guard that misses the
 *   next spelling; pretending otherwise is worse than the gap, so the gaps are written down
 *   rather than papered over.
 * - **the wiring check is not a scan at all**: it asserts the dialog hands its two values
 *   to the engine, which is the defect this whole change is about — two visible controls
 *   that do nothing. Reverting the fix fails it, whatever the arithmetic looks like.
 *
 * The arithmetic itself lives in `crates/draw-engine/tests/ci_export_png.rs`; this is the
 * structural half — that the engine is the only place it is written.
 */

const REPO_ROOT = new URL("../../../../../", import.meta.url);

/** The engine's export framing: the padding and the truncation, written down. */
const PNG_RS = new URL("engine/crates/draw-engine/src/export/png.rs", REPO_ROOT);

/** The host's wrapper, which must call WASM rather than compute. */
const ENGINE_TS = new URL("engine/src/engine.ts", REPO_ROOT);

/** The host's own source. Scanned like the app, because it is TypeScript too. */
const ENGINE_SRC = new URL("engine/src/", REPO_ROOT);

/** The dialog with the two controls this task is about. */
const EXPORT_MODAL = new URL("apps/web/src/lib/draw-chrome/DrawExportModal.svelte", REPO_ROOT);

/** The app — where a copy of the sizing would be written to get it wrong. */
const WEB_SRC = new URL("apps/web/src/", REPO_ROOT);

/** Both trees, so one loop checks the app and the host and neither can be forgotten. */
const SHIPPED = [WEB_SRC, ENGINE_SRC];

/**
 * The engine's own values, pinned. A move is a deliberate edit here, not a surprise: the
 * padding is quoted in `docs/reference/` and the truncation is the difference between a
 * 220- and a 221-pixel-wide export of the same drawing.
 */
const PINNED: ReadonlyArray<{ what: string; pattern: RegExp; line: number }> = [
  {
    what: "DEFAULT_EXPORT_PADDING",
    pattern: /^pub const DEFAULT_EXPORT_PADDING: f64 = /,
    line: 18,
  },
  { what: "pixel_width", pattern: /\(self\.width \* self\.scale\)\.trunc\(\) as u32/, line: 129 },
  { what: "pixel_height", pattern: /\(self\.height \* self\.scale\)\.trunc\(\) as u32/, line: 134 },
];

/**
 * What a line calling `exportPng` may not also contain.
 *
 * Matched on the arithmetic and on the browser calls, not on names, so renaming a local
 * does not get a copy past. `/` is here because on such a line it is a computed ratio or a
 * division and nothing else — a path in a string would be a comment, and comments are
 * stripped before this runs.
 */
const ON_A_FORWARD: ReadonlyArray<{ what: string; pattern: RegExp }> = [
  { what: "a multiplication", pattern: /\*/ },
  { what: "a division or computed ratio", pattern: /\/|\+|-/ },
  { what: "a Math call", pattern: /Math\./ },
  { what: "its own canvas", pattern: /createElement|getContext|toBlob|toDataURL/ },
  { what: "the device pixel ratio", pattern: /devicePixelRatio/ },
  { what: "a padding of its own", pattern: /padding/i },
];

/**
 * What a file that hands the export to WASM may not contain anywhere.
 *
 * This is the rule that catches a copy hidden in a **method**, which a statement window
 * cannot: a mutation that moved the sizing into a private `deviceRatio()` beside the call
 * left the calling line clean, and read `globalThis.devicePixelRatio` and a `*` three lines
 * down. No window reaches that. Banning the two ingredients a copy needs — the device pixel
 * ratio, and a canvas of the file's own — at file granularity does.
 *
 * It holds today for every file that exports: `engine/src/host/bindCanvas.ts` does read
 * `devicePixelRatio`, and it does not call the export, so the on-screen canvas keeps its
 * own. What it does **not** catch is a copy written without either ingredient — a `scale * 2`
 * against a stored constant is still a second truth, and nothing here sees it. That is the
 * honest limit of a source scan, and `TREE_WIDE` below is where the rest of it is written.
 */
const IN_A_FILE_THAT_EXPORTS: ReadonlyArray<{ what: string; pattern: RegExp }> = [
  { what: "the device pixel ratio", pattern: /devicePixelRatio/ },
  { what: "a canvas of its own", pattern: /createElement|getContext|toBlob|toDataURL/ },
];

/**
 * Tree-wide, over the app and the engine's host layer. Each of these is the whole of what
 * it catches, and that is the honest limit.
 */
const TREE_WIDE: ReadonlyArray<{ what: string; pattern: RegExp; misses: string }> = [
  {
    what: "the app encodes a raster with a named image type",
    pattern: /toBlob\([^)]*image\//,
    misses:
      "a `toBlob` that takes its type from a variable — which `imageFile.ts` does, on purpose, to re-encode an uploaded file",
  },
  {
    what: "the app builds a data URL instead of a blob",
    pattern: /toDataURL\(/,
    misses: "nothing — this is the only spelling of it",
  },
  {
    what: "the app truncates a dimension, as the export's sizing does",
    pattern: /Math\.trunc\(/,
    misses:
      "the same arithmetic written as `Math.floor` or `| 0`, which is why the path-anchored check above is the one that carries this file",
  },
];

/** Comments dropped: a test that trips over prose about a deleted copy is noise. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** A file's text, or `""` when it is not there. */
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
 * `.svelte` is scanned and `.test.ts` is not, for the reason `cameraParity.test.ts` gives:
 * the only consumer of an export is a Svelte component, and this file's own assertions
 * mention the arithmetic it is hunting.
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

/**
 * A `.svelte` file's script, or a `.ts` file whole.
 *
 * A call to the export can only be written in a script, and only the script is where a copy
 * of the sizing would go. The template is not scanned because markup mentions the handler
 * by name — `onclick={exportPng}` — and a name in markup is not a call, so scanning it
 * would flag every button that opens the dialog.
 */
function codeOf(path: string, lines: string[]): string {
  const text = lines.join("\n");
  if (!path.endsWith(".svelte")) return text;
  const script = /<script[^>]*>([\s\S]*?)<\/script>/.exec(text);
  return script?.[1] ?? "";
}

/**
 * Every `exportPng` call, with the statement in front of it glued on.
 *
 * Two statements, not one, and the second is not decoration: a copy of the sizing hoisted
 * a line up reads `const chosen = scale * 2;` on its own, which mentions neither the export
 * nor an operator the patterns look for, and a one-statement window waves it through. The
 * window is still a window — a copy three statements up, or in the function above, is
 * missed, which is what the tree-wide check below is for.
 */
function callsOf(path: string, lines: string[], call: string): string[] {
  const statements = codeOf(path, lines)
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  return statements.flatMap((statement, index) =>
    statement.includes(call) ? [statements[index - 1] ?? "", statement] : [],
  );
}

/**
 * Every number the front still chooses about an export, and who owns removing it.
 *
 * Both are the same padding — the oracle's is 10 (`constants.ts@1118751f:398`) and the SVG
 * path uses 16, six pixels apart per side — in the two places it is written down: the
 * dialog passes one, and the host's wrapper defaults to the other. §2 allows the front to
 * pass a user's intent, not to invent a margin, so both are the same violation at two
 * depths. Moving either is 4.5's: it changes the SVG export's output and its tests.
 *
 * So they are named here rather than fixed, and this list is the ratchet — the forward
 * check skips exactly these and no more, and the ratchet test fails on a *third*. 4.5
 * cannot add one on its way past the two it is there to remove.
 */
const KNOWN_FRONT_NUMBERS: readonly { path: string; find: RegExp; owner: string }[] = [
  { path: "draw-chrome/DrawExportModal.svelte", find: /exportSvg\(\s*-?\d/, owner: "4.5" },
  { path: "engine/src/engine.ts", find: /exportSvg\(\s*padding\s*=\s*-?\d/, owner: "4.5" },
];

/** The one known-debt site a statement belongs to, if it is one. */
function knownOwner(path: string, statement: string): string | null {
  return (
    KNOWN_FRONT_NUMBERS.find(
      ({ path: wanted, find }) => path.endsWith(wanted) && find.test(statement),
    )?.owner ?? null
  );
}

/** Every known-debt site in the tree, found rather than assumed. */
function foundFrontNumbers(shipped: Iterable<[string, string[]]>): string[] {
  const found: string[] = [];
  for (const [path, lines] of shipped) {
    for (const { find, owner } of KNOWN_FRONT_NUMBERS) {
      if (!path.endsWith(path)) continue;
      for (const statement of codeOf(path, lines).split(";")) {
        const text = statement.trim();
        if (find.test(text)) found.push(`${owner}: ${path} — ${text.replace(/\s+/g, " ")}`);
      }
    }
  }
  return found;
}

describe("the engine's export framing", () => {
  const pngRs = readFileSync(PNG_RS, "utf8").split("\n");

  it("still holds the padding and the truncation where this says it does", () => {
    for (const { what, pattern, line } of PINNED) {
      const found = pngRs.findIndex((text) => pattern.test(text)) + 1;
      expect(
        found,
        `png.rs should compute ${what} on line ${line}, found it on line ${found}`,
      ).toBe(line);
    }
  });

  it("is the padding the oracle uses, not one of our own", () => {
    // `DEFAULT_EXPORT_PADDING = 10` (constants.ts@1118751f:398). Written here as a number
    // because the whole file is about a number that is easy to get quietly wrong: 16 is
    // what the SVG export defaults to, and the two exports are 6px apart per side.
    const declaration =
      pngRs.find((text) => /^pub const DEFAULT_EXPORT_PADDING: f64 = /.test(text)) ?? "";
    expect(declaration, "the padding is the oracle's 10, not the SVG path's 16").toContain("10.0");
  });
});

describe("the app and the engine's host", () => {
  const shipped = SHIPPED.flatMap((dir) => [...shippedSourceLines(dir)]);

  it("has files to check, and sees both the dialog and the host's own source", () => {
    // The count and the `.svelte` count are here to stop a scan quietly narrowing to one
    // tree or to `.ts` only; the two named files are here to stop it quietly narrowing to
    // a subset of either.
    expect(shipped.length).toBeGreaterThan(50);
    const svelte = shipped.filter(([path]) => path.endsWith(".svelte"));
    expect(svelte.length).toBeGreaterThan(10);
    expect(shipped.some(([path]) => path.endsWith("draw-chrome/DrawExportModal.svelte"))).toBe(
      true,
    );
    expect(shipped.some(([path]) => path.endsWith("engine.ts"))).toBe(true);
  });

  it("calls the export without touching a number on the way", () => {
    const found: string[] = [];
    for (const [path, lines] of shipped) {
      for (const statement of callsOf(path, lines, "exportPng(")) {
        // The two known-debt sites are the SVG path's padding, which the statement before
        // an `exportSvg` call carries; the ratchet test below counts them, so skipping
        // them here cannot hide a third.
        if (knownOwner(path, statement)) continue;
        for (const { what, pattern } of ON_A_FORWARD) {
          if (pattern.test(statement)) {
            found.push(`${path} — ${what} in \`${statement.replace(/\s+/g, " ")}\``);
          }
        }
      }
    }
    expect(
      found,
      "the front must hand the engine the scale and the flag, not do the sizing (BUNNY.md §2)",
    ).toEqual([]);
  });

  it("gives no file that exports a canvas or a device ratio of its own", () => {
    const found: string[] = [];
    for (const [path, lines] of shipped) {
      if (!codeOf(path, lines).includes("exportPng(")) continue;
      lines.forEach((line, index) => {
        for (const { what, pattern } of IN_A_FILE_THAT_EXPORTS) {
          if (pattern.test(line)) found.push(`${path}:${index + 1} — ${what}`);
        }
      });
    }
    expect(
      found,
      "a file that hands the export to WASM does not decide what the export is (BUNNY.md §2)",
    ).toEqual([]);
  });

  it("carries none of the export's arithmetic anywhere in either tree", () => {
    const found: string[] = [];
    for (const [path, lines] of shipped) {
      lines.forEach((line, index) => {
        for (const { what, pattern } of TREE_WIDE) {
          if (pattern.test(line)) found.push(`${path}:${index + 1} — ${what}`);
        }
      });
    }
    expect(
      found,
      "the export's framing and size are the engine's (ExportFrame, png.rs). " +
        TREE_WIDE.map((r) => `does not catch: ${r.misses}`).join("; "),
    ).toEqual([]);
  });

  it("finds exactly the front-chosen numbers it already knows about", () => {
    // A ratchet, not a gap: both of the numbers the front still owns are named above with
    // the task that owns removing them, so a third — or one of these somewhere else — is a
    // failure here rather than a note nobody reads.
    const found = foundFrontNumbers(shipped);
    expect(
      found.length,
      `every number the front still chooses about an export, and who owns it: ${
        found.length ? found.join("; ") : "none — a known one has moved or gone"
      }`,
    ).toBe(KNOWN_FRONT_NUMBERS.length);
  });
});

describe("the dialog the two controls belong to", () => {
  const modal = withoutComments(sourceOf(EXPORT_MODAL));

  it("hands both values to the engine, so neither control is decoration", () => {
    // The defect this change exists to fix: `transparent` was declared and bound to a
    // checkbox and read nowhere, and `scale` was shown in the card's own text while the
    // button underneath ignored it. Read as one call, because that is how they are used.
    expect(modal, "the dialog should call the engine's export").toContain("exportPng(");
    const call = modal.split("\n").find((line) => line.includes("exportPng(")) ?? "";
    expect(call, "the export call should carry the scale the chips chose").toMatch(/\bscale\b/);
    expect(call, "the export call should carry the transparent toggle").toMatch(/\btransparent\b/);
  });

  it("offers the three scales the oracle offers", () => {
    // `EXPORT_SCALES = [1, 2, 3]` (constants.ts@1118751f:397), which the oracle's own dialog
    // renders. Which chips to show is chrome, so it stays here — what they mean is the
    // engine's, and the engine takes whatever number it is given rather than clamping.
    expect(modal).toMatch(/#each \[1, 2, 3\] as s/);
  });
});

describe("the wrapper the front calls", () => {
  const wrapper = withoutComments(sourceOf(ENGINE_TS));
  const lines = wrapper.split("\n");
  /** Every call, not the first: one that forwards cleanly says nothing about a second. */
  const calls = lines.filter((line) => line.includes("this.inner.exportPng("));

  it("forwards to WASM without computing anything on the way", () => {
    expect(calls.length, "engine/src/engine.ts should call the exportPng binding").toBeGreaterThan(
      0,
    );
    for (const { what, pattern } of ON_A_FORWARD) {
      for (const call of calls) {
        expect(call, `the wrapper does ${what} itself`).not.toMatch(pattern);
      }
    }
  });

  it("leaves the defaults to the engine, where the oracle keeps them", () => {
    // `exportBackground` true and an `exportScale` of the device pixel ratio when that is
    // one of the three, 1 otherwise (`appState.ts@1118751f:20-22, 70`). A `?? 2` here would
    // be a second answer to a question the engine already answers.
    expect(calls.join("\n")).toMatch(/options\.scale/);
    expect(calls.join("\n")).toMatch(/options\.transparent/);
  });
});
