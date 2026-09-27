import { readFileSync, readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Law 3, as a test: what a pasted plain text *becomes* is the engine's to decide
 * (BUNNY.md §2), and the front only reads the clipboard and calls the engine method.
 *
 * The decisions are four and they are all scene data — one element per line, the wrap
 * width, the placement at the pointer, the element that is minted. Every one of them is
 * the oracle's `addTextFromPaste` (`packages/excalidraw/components/App.tsx@1118751f:
 * 4979-5096`), and every one of them is now in `engine/crates/draw-engine/src/engine/
 * paste_text.rs`, asserted in `ci_paste_text.rs`.
 *
 * Nothing stops the next person from re-deriving one of them in a `.svelte` file, and the
 * result would still look right in a screenshot: a paste of two lines still makes two
 * elements, only the wrap width or the gap is the front's own idea now. This scan is the
 * only thing that fails. It is a source scan rather than a behavioural one precisely
 * because the behaviour it forbids is the behaviour everything else already checks.
 */

/**
 * Every `.ts`/`.svelte` under a root, so a new file is covered without a list.
 *
 * The engine's TypeScript host (`engine/src`) is scanned as well as the front, and for
 * the same reason: it is the other place a paste is read before it reaches the engine, and
 * a `split("\n")` or a wrap constant written there is exactly as much a second answer as
 * one written in a `.svelte` file. Nothing in either tree trips the patterns today, so the
 * scan costs nothing until someone breaks law 3.
 */
function sourcesIn(dir: URL): URL[] {
  // `new URL(".", …)` on a URL with no trailing slash resolves to its *parent*, so a
  // directory has to be spelled as one before the walk starts — otherwise the walk climbs
  // out of the tree and never comes back.
  const root = new URL(`${dir.pathname.replace(/\/?$/, "/")}`, dir);
  const out: URL[] = [];
  for (const entry of readdirSync(root)) {
    const path = new URL(entry, root);
    if (statSync(path).isDirectory()) {
      out.push(...sourcesIn(path));
    } else if (/\.(ts|svelte)$/.test(entry) && !/\.test\.ts$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

/** The engine's own sources, which the front is not allowed to have copied. */
const engineSrc = (path: string) => new URL(`../../../../../engine/${path}`, import.meta.url);

const SOURCES = [...sourcesIn(new URL(".", import.meta.url)), ...sourcesIn(engineSrc("src/"))];

/** The path from `apps/web/` or `engine/`, whichever the file is under, for a failure. */
const label = (path: URL) => {
  const pathname = decodeURIComponent(path.pathname);
  for (const root of ["/apps/web/", "/engine/"]) {
    const at = pathname.indexOf(root);
    if (at >= 0) return pathname.slice(at + 1);
  }
  return pathname;
};

const read = (path: URL) => readFileSync(path, "utf8");

/**
 * The files that turn a paste into scene elements — the only ones the scans below judge.
 *
 * A file qualifies by *calling* one of the engine's paste methods, which is what a second
 * answer to any of the four decisions would have to sit beside. Scoping it this way rather
 * than banning `split("\n")` across the whole front matters: the text editor splits a
 * textarea's own value into lines (`textEditor.ts:116`) and is right to, because none of
 * those lines ever becomes an element.
 */
const PASTE_SITES = SOURCES.filter((path) =>
  /\.paste(Json|Text)\(|\.insertJson\(|paste_mermaid\(/.test(read(path)),
);

describe("law 3: a pasted text is built by the engine", () => {
  it("finds both trees' sources at all, so the scans below are not vacuous", () => {
    expect(SOURCES.length).toBeGreaterThan(40);
    expect(SOURCES.some((p) => p.pathname.endsWith("draw-chrome/DrawSurface.svelte"))).toBe(true);
    expect(SOURCES.some((p) => p.pathname.endsWith("engine/src/host/keyboardInput.ts"))).toBe(true);
  });

  it("finds every paste site, so the scans below are not vacuous either", () => {
    // Every file that calls a paste method, listed: a new one is added here as it appears,
    // which is the moment to notice it is a place the four decisions could leak into.
    expect(PASTE_SITES.map(label).sort()).toEqual([
      "apps/web/src/lib/draw-chrome/DrawContextMenu.svelte",
      "apps/web/src/lib/draw-chrome/DrawMermaidModal.svelte",
      "apps/web/src/lib/draw-chrome/DrawSurface.svelte",
      "engine/src/engine.ts",
      "engine/src/host/keyboardInput.ts",
    ]);
  });

  it("never splits pasted text into lines in the front", () => {
    // The oracle's `text.split("\n")` (`App.tsx@1118751f:5017`) decides how many elements
    // a paste makes. Beside a paste call in the front it would be a second answer to that,
    // free to disagree with the engine's about CRLF, about a trailing newline, and about a
    // blank line. Every spelling counts: a literal, a template, or a regex with the
    // optional `\r` a Windows clipboard leaves behind.
    for (const path of PASTE_SITES) {
      const source = read(path);
      expect(source, label(path)).not.toMatch(/split\(\s*(["'`])[^)]*\\n/);
      expect(source, label(path)).not.toMatch(/split\(\s*\/(?:\\.|\[(?:\\.|[^\]])*\]|[^/\\])*\\r/);
    }
  });

  it("never carries a pasted-text wrap width in the front", () => {
    // `Math.max(Math.min((x2 - x1) * 0.5, 800), 200)` (`App.tsx@1118751f:5011-5013`) is
    // half the *visible* width in scene units — a number only the engine, which holds the
    // camera and the viewport, can compute. A constant pair in the front is a wrap width
    // that ignores the zoom, and the shape of it is unmistakable.
    for (const path of PASTE_SITES) {
      const source = read(path);
      expect(source, label(path)).not.toMatch(/maxTextWidth|maxTextWidthPx|WRAP_WIDTH/);
      expect(source, label(path)).not.toMatch(/\b(800|200)\b[^\n]*\b(width|wrap)\b/i);
      expect(source, label(path)).not.toMatch(/\b(width|wrap)\b[^\n]*\b(800|200)\b/i);
    }
  });

  it("never places a pasted text itself: no pointer arithmetic beside a paste", () => {
    // The oracle centres each line on the pointer's `x` and walks `currentY` down by the
    // line height plus a gap (`App.tsx@1118751f:5038-5039`, `:5052`). A `screenToWorld` on
    // the paste path is fine — that is the pointer, and `pasteJson` already took one — but
    // arithmetic on the result is the front computing where a scene element goes.
    for (const path of PASTE_SITES) {
      for (const line of read(path).split("\n")) {
        if (!/paste(Text|Json)\(|insertJson\(/.test(line)) continue;
        expect(line, `${label(path)}: ${line.trim()}`).not.toMatch(
          /[+\-*/]\s*(width|height|fontSize|CHAR|LINE|GAP)\b/,
        );
      }
    }
  });

  it("calls the engine's own paste-text method, and the engine is what owns it", () => {
    // Positive, so the scans above cannot pass by the paste having been deleted: the
    // clipboard is read in the front and turned into elements by `pasteText`, whose four
    // decisions are `paste_text.rs`'s.
    const host = read(engineSrc("src/host/keyboardInput.ts"));
    expect(host).toContain("engine.pasteText(");
    // The engine's own JSON is tried first, so our JSON keeps taking the element branch.
    expect(host.indexOf("engine.pasteJson(")).toBeLessThan(host.indexOf("engine.pasteText("));

    const engine = read(engineSrc("crates/draw-engine/src/engine/paste_text.rs"));
    // The four decisions, by the constants the oracle wrote them as.
    expect(engine).toContain("pub fn paste_text(");
    expect(engine).toContain("text.split('\\n')");
    expect(engine).toContain("MAX_PASTE_TEXT_WIDTH: f64 = 800.0");
    expect(engine).toContain("MIN_PASTE_TEXT_WIDTH: f64 = 200.0");
    expect(engine).toContain("LINE_GAP: f64 = 10.0");
    // Minted by the engine's own text path, not by a second minting of its own.
    expect(engine).toContain("self.new_text_element(");
  });
});
