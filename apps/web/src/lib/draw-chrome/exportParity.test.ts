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
 *
 * **The two truncation lines move whenever `ExportOptions` grows a field**, because
 * `pixel_width` and `pixel_height` sit below the struct and every doc line a new field
 * brings with it pushes them down. 4.5 added `dark_mode` and moved them from 190/195 to
 * 207/212; 4.4 hit the same thing and this ratchet caught it mid-edit. So the numbers are
 * here to be *updated on purpose* — a move nobody meant is a bug report, and a move somebody
 * meant is a deliberate edit to this table. A test that only asserted "the padding is 10"
 * would have waved both through.
 */
const PINNED: ReadonlyArray<{ what: string; pattern: RegExp; line: number }> = [
  {
    what: "DEFAULT_EXPORT_PADDING",
    pattern: /^pub const DEFAULT_EXPORT_PADDING: f64 = /,
    line: 18,
  },
  { what: "pixel_width", pattern: /\(self\.width \* self\.scale\)\.trunc\(\) as u32/, line: 207 },
  { what: "pixel_height", pattern: /\(self\.height \* self\.scale\)\.trunc\(\) as u32/, line: 212 },
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
 * What a line handing over a file's **bytes** may not also contain.
 *
 * The round trip (4.4) is a third door to the same engine, and this is what it is guarded
 * by. The rules above are about the *arithmetic* of an export; this is about the *payload*,
 * and it is a separate list because the two have nothing in common: a front that base64'd
 * a scene, escaped a JSON string or assembled a PNG chunk beside the call would be
 * building a file, and nothing above would see it — `ON_A_FORWARD` has no pattern for
 * `atob`, and `TREE_WIDE` has none for a `charCodeAt` loop.
 *
 * `Uint8Array` and `TextDecoder` are in here and are **not** what they look like: a host
 * that hands the engine a `File`'s bytes has to hold them in one of the two, and
 * `openFile.ts` does. The claim being checked is that the *bytes on the way in* are the
 * file's own and not something the front derived, so a `Uint8Array` **on the line that
 * calls the engine** is the tell — which is why this is a statement check and not a
 * file-at-large one, like `ON_A_FORWARD` and for the same reason.
 */
const ON_A_BYTES_FORWARD: ReadonlyArray<{ what: string; pattern: RegExp }> = [
  { what: "a base64 step", pattern: /\batob\b|\bbtoa\b|base64/i },
  { what: "a hand-built PNG chunk", pattern: /tEXt|iEND|chunk/i },
  { what: "a hand-rolled string encoder", pattern: /charCodeAt|fromCharCode|TextEncoder/ },
  { what: "a checksum of its own", pattern: /crc|checksum/i },
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
 * The shapes a front-chosen number about an export has taken here.
 *
 * **These are the detector; [`KNOWN_FRONT_NUMBERS`] is only the allow-list.** Keeping them
 * apart is the whole point, and getting it wrong is silent: the first version of this file
 * held the two patterns *inside* the known-debt entries, so emptying the list to record that
 * 4.2 paid the debt also switched the detector off. Reintroducing `engine.exportSvg(16)` in
 * the dialog then left all twelve tests green — the check that exists to catch exactly that
 * could no longer see the thing it looks for. An allow-list is not a detector.
 *
 * Each pattern is one spelling of "the front picked a number for an export", and the honest
 * limit is that a new spelling is a new entry here. `ON_A_FORWARD` above is the other half of
 * it and catches the arithmetic; this catches the bare number at the call.
 */
const FRONT_NUMBER_PATTERNS: ReadonlyArray<{ what: string; find: RegExp }> = [
  { what: "a number passed to exportSvg", find: /exportSvg\(\s*-?\d/ },
  { what: "a padding defaulted in the wrapper", find: /exportSvg\(\s*padding\s*=\s*-?\d/ },
  { what: "a number passed to exportPng", find: /exportPng\(\s*-?\d/ },
  // The clipboard copy is a second door to the same export, so it is the same question: the
  // type, the size and the scope all come from `engine.clipboardCopy`, and a number at this
  // call would be the front choosing a margin or a scale for a picture it does not measure.
  { what: "a number passed to clipboardCopy", find: /clipboardCopy\(\s*-?\d/ },
];

/**
 * Every number the front still chooses about an export, and who owns removing it.
 *
 * **Empty, and that is the point.** It held two entries — the dialog passing a padding of 16
 * and the host's wrapper defaulting to the other 16, six pixels a side wider than the oracle's
 * 10 (`constants.ts@1118751f:398`) — and 4.2 removed both. `exportSvg` takes an options
 * object now and the margin comes from the engine's `ExportOptions`, the same struct and the
 * same 10 the PNG path uses, so there is no longer a place in the front where a margin can be
 * written.
 *
 * It is kept as an empty list rather than deleted because a ratchet that only exists while it
 * has entries is gone exactly when it would next be useful. With nothing in it the test below
 * fails on the **first** number the front chooses about an export, which is the state worth
 * being permanently on guard for.
 */
const KNOWN_FRONT_NUMBERS: readonly { path: string; find: RegExp; owner: string }[] = [];

/** The two exports, which are about arithmetic. */
const EXPORT_DOORS = ["exportPng(", "exportSvg("];

/**
 * The doors a **file's bytes** come through, which are about the payload.
 *
 * `restoreFromImage` is the engine's own (`wasm/input.rs`); the other two are named here
 * only so a front that grew its own spelling of them is still caught.
 */
const FILE_DOORS = ["restoreFromImage(", "restoreFromFile("];

/** The one known-debt site a statement belongs to, if it is one. */
function knownOwner(path: string, statement: string): string | null {
  return (
    KNOWN_FRONT_NUMBERS.find(
      ({ path: wanted, find }) => path.endsWith(wanted) && find.test(statement),
    )?.owner ?? null
  );
}

/**
 * Every front-chosen number in the tree, found rather than assumed, and each with the task
 * that owns removing it.
 *
 * The `path` in a known entry is **not** applied as a filter here, deliberately: an entry says
 * "this site, this owner", and a pattern matching somewhere *else* is a new debt rather than
 * the known one. So a pattern found outside its declared file is reported under the detector's
 * own wording, and the count check below fails on it.
 */
function foundFrontNumbers(shipped: Iterable<[string, string[]]>): string[] {
  const found: string[] = [];
  for (const [path, lines] of shipped) {
    const statements = codeOf(path, lines)
      .split(";")
      .map((text) => text.trim())
      .filter(Boolean);
    for (const { what, find } of FRONT_NUMBER_PATTERNS) {
      for (const text of statements) {
        if (find.test(text)) {
          found.push(
            `${knownOwner(path, text) ?? "unowned"}: ${path} — ${what} in \`${text.replace(/\s+/g, " ")}\``,
          );
        }
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
      // All three doors, because all three take a caller's intent and all three had a
      // front-chosen number or a front-built payload in them. Checking only `exportPng` is
      // what let the SVG path's 16 sit there through 4.1 — the check was green and the debt
      // was real — and checking only the two exports is what would have let the round
      // trip's front build a base64 payload beside `restoreFromImage` in 4.4.
      for (const call of [...EXPORT_DOORS, ...FILE_DOORS]) {
        for (const statement of callsOf(path, lines, call)) {
          if (knownOwner(path, statement)) continue;
          for (const { what, pattern } of ON_A_FORWARD) {
            if (pattern.test(statement)) {
              found.push(`${path} — ${what} in \`${statement.replace(/\s+/g, " ")}\``);
            }
          }
          // The bytes door is checked on its own vocabulary, and only on the statements
          // that hand a file's bytes over.
          if (FILE_DOORS.some((door) => statement.includes(door))) {
            for (const { what, pattern } of ON_A_BYTES_FORWARD) {
              if (pattern.test(statement)) {
                found.push(`${path} — ${what} in \`${statement.replace(/\s+/g, " ")}\``);
              }
            }
          }
        }
      }
    }
    expect(
      found,
      "the front must hand the engine the scale and the flags, not do the sizing " +
        "(BUNNY.md §2)",
    ).toEqual([]);
  });

  it("gives no file that exports a canvas or a device ratio of its own", () => {
    const found: string[] = [];
    for (const [path, lines] of shipped) {
      if (![...EXPORT_DOORS, ...FILE_DOORS].some((door) => codeOf(path, lines).includes(door)))
        continue;
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

  /**
   * Both switches reach **both** formats — the defect 4.5 exists to fix.
   *
   * "Transparent background" and "Dark mode" are two rows in the same `<div>`, above three
   * format cards, so a reader — and a person — has no way to tell that one of them meant
   * "for the raster only". They did: the SVG exporter wrote its paper `<rect>` whatever the
   * switch said, and the dialog's vector button passed `selectionOnly` alone. The oracle
   * hands both to `exportToSvg` (`export.ts@1118751f:296-305`) and draws the rect under the
   * same `exportBackground` (`:458`).
   *
   * Written as a call window rather than a line, because both calls are spread over
   * several lines now, and a line-filter would only see `engine.exportSvg(` — which carries
   * none of the arguments, and so could not tell a forwarded call from a dropped one. That
   * is the same weakness `callWindows` exists below for the wrapper, and the same reason.
   */
  it("hands both switches to the vector export, not only to the raster one", () => {
    const script = /<script[^>]*>([\s\S]*?)<\/script>/.exec(modal)?.[1] ?? "";
    const calls = callWindows(script.split("\n"), "engine.exportSvg(");
    expect(calls.length, "the dialog should call the SVG export once").toBe(1);
    expect(calls[0], "the SVG export should carry the transparent switch").toMatch(
      /\btransparent\b/,
    );
    expect(calls[0], "and the dark-mode one").toMatch(/\bdarkMode\b/);
    expect(calls[0], "and still the selection checkbox").toMatch(/\bselectionOnly\b/);
    // And the raster one, the same way, so the two cannot drift apart again.
    const png = callWindows(script.split("\n"), "engine.exportPng(");
    expect(png.length, "the dialog should call the PNG export once").toBe(1);
    expect(png[0]).toMatch(/\btransparent\b/);
    expect(png[0]).toMatch(/\bdarkMode\b/);
  });
});

describe("the wrapper the front calls", () => {
  const wrapper = withoutComments(sourceOf(ENGINE_TS));
  const lines = wrapper.split("\n");
  /**
   * Every call as a window, not as a line.
   *
   * Both exports are forwarded across several lines now that a third argument exists, and a
   * line-filter saw only `this.inner.exportPng(` — which carries none of the arguments and
   * so could not tell a forwarded call from one that dropped the caller's intent. From the
   * first line naming the binding to the statement's closing `;`.
   */
  const calls = callWindows(lines, "this.inner.exportPng(");
  const svgCalls = callWindows(lines, "this.inner.exportSvg(");

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
    // And the two that are booleans with a default, which a `?? true` here would also
    // answer a second time: `exportBackground: true` (`appState.ts@1118751f:69`) and
    // `exportWithDarkMode: false` (`:72`). Forwarded, not defaulted.
    expect(calls.join("\n")).toMatch(/options\.darkMode/);
    expect(svgCalls.join("\n"), "the vector path takes both switches too").toMatch(
      /options\.transparent[\s\S]*options\.darkMode/,
    );
  });

  it("hands the selection over rather than deciding what one is", () => {
    // The one intent a host may pass (§2): the dialog's checkbox, the oracle's
    // `exportSelectionOnly` (`data/index.ts@1118751f:56-58`). Which of the three it means —
    // scene, selection, one frame — is the engine's, because an empty selection is the scene
    // and a single selected frame is a frame export, and a front that picked either would be
    // a second answer to a question with one right answer.
    expect(svgCalls.length, "engine/src/engine.ts should call the exportSvg binding").toBe(1);
    for (const call of svgCalls) {
      // And no length argument at all: the old signature was `exportSvg(padding)` and the
      // margin has no route through the front any more.
      expect(call, "the SVG wrapper passes a number the engine did not ask for").not.toMatch(
        /exportSvg\(\s*-?\d/,
      );
    }
    expect(svgCalls.join("\n")).toMatch(/options\.selectionOnly/);
    expect(calls.join("\n")).toMatch(/options\.selectionOnly/);
  });

  it("gives the clipboard copy's type, size and scope no route through the front", () => {
    // The clipboard is a third door to the same export, and it is the one with the most to
    // get wrong: a host that named its own MIME type would paste into nothing, and one that
    // chose a scope would have a second element-list decision that happens to agree today.
    // So the wrapper is read the same way the two exports are, and the call it forwards is
    // a format name and the browser's two capabilities — nothing that sizes anything.
    const clipboardCalls = callWindows(lines, "this.inner.clipboardCopy(");
    expect(
      clipboardCalls.length,
      "engine/src/engine.ts should call the clipboardCopy binding",
    ).toBe(1);
    const call = clipboardCalls[0]!;
    // No number: not a padding, not a scale, not a MIME type spelled as one.
    expect(call, "the clipboard wrapper passes a number the engine did not ask for").not.toMatch(
      /-?\d/,
    );
    // The format is a name from a two-valued union, not a loose string.
    expect(call).toMatch(/\bformat\b/);
    // And no `selectionOnly` at all: the oracle's two copy actions pass the literal `true`
    // to `prepareElementsForExport` (`actionClipboard.tsx@1118751f:139, 212`), so there is
    // no dialog checkbox for a copy and nothing for the front to narrow.
    expect(call).not.toMatch(/selectionOnly/);
  });
});

/**
 * Every call to `needle` as the whole statement it belongs to, across line breaks.
 *
 * A `filter` on a single line is what this replaces, and it is a real weakness rather than a
 * theoretical one: both exports are now forwarded over several lines, so a line-filter
 * captured only the opening `this.inner.exportPng(` and every assertion about the arguments
 * below it was asserting about a fragment. Ends at the statement's `;` or at the call's own
 * `)`, whichever comes first, so two calls in one expression are still two windows.
 */
function callWindows(lines: string[], needle: string): string[] {
  const found: string[] = [];
  lines.forEach((line, index) => {
    if (!line.includes(needle)) return;
    let window = line;
    for (let ahead = index + 1; !window.includes(";") && ahead < lines.length; ahead++) {
      window += `\n${lines[ahead]}`;
    }
    found.push(window);
  });
  return found;
}
