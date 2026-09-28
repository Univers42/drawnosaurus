import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readChecklists } from "../src/checklist.ts";
import { RULES, ruleFor, type Status } from "../src/registry.ts";

/**
 * The export lines p4.1 claims, one by one, where a reader can check them.
 *
 * The conformance gate prints a total, and a total cannot be argued with: it says 651 and
 * nothing about which lines moved. A registry edit that is wrong is invisible in a count.
 * So this file states the claims explicitly — the lines this change closed, the lines it
 * deliberately did not, and the reason each of those is still a gap.
 *
 * The total was checked against the base by resolving every line under both registries:
 * 646 -> 651, and exactly five lines moved, all `gap` -> `covered` (design.md 1329, 1331,
 * 1335; shortkey.md 434, 446). None moved the other way — shortkey.md:444 "Export entire
 * canvas" was already `covered` through the section catch-all, and shortkey.md:436 "Copy PNG
 * to clipboard" was already a `gap`. Both facts are why the figure is five and not six.
 *
 * It is deliberately narrow. The gate still owns "every line is classified" and "every
 * named test file exists"; this owns nothing but the export block's honesty.
 */

const REPO = join(import.meta.dirname, "..", "..", "..");
const items = readChecklists(join(REPO, "prompt"));

/**
 * What the registry says about one checklist line, named by its document and line.
 *
 * By position, not by text: "Background color" is on `design.md` three times — in
 * `10. Images`, in `20. Fill and stroke system` and in `32. Export` — and only the third
 * is this task's business. A lookup by text alone silently answers about the first one,
 * which is a rule about filling a shape, not about exporting.
 */
function statusOf(source: string, line: number): Status | "unclassified" {
  const item = items.find((candidate) => candidate.source === source && candidate.line === line);
  expect(item, `${source}:${line} should be a line of the checklists`).toBeDefined();
  return ruleFor(item!)?.status ?? "unclassified";
}

/** The lines p4.1 closes, each as where it is written. */
const CLOSED_BY_P41: ReadonlyArray<[string, number, string]> = [
  // design.md:1329 — the whole scene, in a canvas of its own rather than the viewport's.
  ["design.md", 1329, "Canvas → PNG"],
  // design.md:1331 — the dialog's transparent toggle, which did nothing until now.
  ["design.md", 1331, "Transparent background"],
  // design.md:1335 — the three chips, which changed nothing until now.
  ["design.md", 1335, "Scale"],
  // shortkey.md:434 and :446 — "Export PNG", once under Files and once under Export tricks.
  ["shortkey.md", 434, "Export PNG"],
  ["shortkey.md", 446, "Export PNG"],
  // shortkey.md:444 — the whole canvas, which is the framing the export now uses.
  ["shortkey.md", 444, "Export entire canvas"],
];

/**
 * The lines around them that stay gaps, because each belongs to another task.
 *
 * The 4.2 entries left this list when 4.2 landed — `design.md:1337` "Selection export",
 * `shortkey.md:445` "Export selection", `design.md:1339` "Frame export" and
 * `shortkey.md:451` "Export frames where appropriate" — and they are now asserted covered by
 * `CLOSED_BY_P42` below rather than simply deleted, so a later change that reopens one of them
 * has something to fail against.
 *
 * That split is the point. This list is not "the gaps"; it is "the gaps that are gaps *for a
 * reason that has not arrived yet*", and every entry's reason is a task number. A test that
 * hard-codes one task's neighbours as gaps outlives the task and then fails on correct work —
 * which is exactly what this one did, on the first gate after 4.2 merged.
 */
const STILL_GAPS: ReadonlyArray<[string, number, string]> = [
  // design.md:1333 — a *chosen* background colour. The export has the theme's or none (4.5).
  ["design.md", 1333, "Background color"],
  // design.md:1364,1366, shortkey.md:436,448,449 — the clipboard (4.3). 1363 is "Clipboard
  // image", a group label like 1328's "PNG", and the parser drops it: it is a heading for
  // the two lines under it, not a requirement of its own.
  // design.md:1348 — fonts in the SVG (4.6).
  // shortkey.md:437 — a published board. Unrelated to exporting.
  ["shortkey.md", 437, "Export/share read-only link"],
  // shortkey.md:450 — half of it, and the half that is not is the SVG's.
  ["shortkey.md", 450, "Include/exclude background depending on export settings"],
];

/**
 * The four lines 4.2 took off `STILL_GAPS`, asserted covered so the handover is in both
 * directions. Without this they would simply have been deleted, and a later edit that reopened
 * one of them would move the conformance figure with nothing to fail.
 */
const CLOSED_BY_P42: ReadonlyArray<[string, number, string]> = [
  ["design.md", 1337, "Selection export"],
  ["shortkey.md", 445, "Export selection"],
  ["design.md", 1339, "Frame export"],
  ["shortkey.md", 451, "Export frames where appropriate"],
];

/**
 * Three lines 4.1 left on `STILL_GAPS`, closed since — by three different tasks, which is the
 * reason they are grouped under one list rather than three.
 *
 * `design.md:1364` "Selection → image" — 4.2, and the DIALOG's choice rather than the
 * clipboard's. `exportParity.test.ts:504-519` asserts the host *hands the decision over*:
 * `options.selectionOnly` reaches the engine for both raster and vector. `:540-543` asserts
 * the opposite for the clipboard, because the oracle's two copy actions pass the literal
 * `true` (`actionClipboard.tsx:139`, `:212`) and have no such option. The same word on both
 * sides means two different things and one test holds both.
 *
 * `design.md:1366` "Whole canvas → image" — 4.1's OWN line, which 4.1 named and did not
 * finish. `e2e/exportPng.spec.ts:525` is "exports the whole scene even when the camera is
 * looking at part of it", and `:386`/`:414` pin the rule 4.2 recorded: an empty selection IS
 * the whole scene (`data/index.ts@1118751f:56-58`, the `else` arm at `:69`).
 *
 * `design.md:1348` "Fonts" — 4.6. The SVG carries the faces
 * (`scene/export.ts@1118751f:439-441` calls `Fonts.generateFontFaceDeclarations`, `:443-451`
 * joins it into `<style class="style-fonts">` inside the defs). The `why` on the rule said the
 * export "names the font families without embedding an @font-face" — the opposite of what
 * shipped, and it came from a grep scoped to `scene/export.ts` and reported as a statement
 * about the oracle. A zero in one file is not a zero.
 *
 * The loop that checks these throws on the FIRST failure, so it reported `1364` alone and said
 * nothing about the other two. **A for-loop that stops at the first failure tells you one
 * thing at a time, and its silence about the rest is not agreement.**
 */
const CLOSED_AFTER_P41: ReadonlyArray<[string, number, string]> = [
  ["design.md", 1364, "Selection → image"],
  ["design.md", 1366, "Whole canvas → image"],
  ["design.md", 1348, "Fonts"],
];

/**
 * Three more lines 4.1 left as gaps, all closed by 4.3 — a copy is the export, unchanged:
 * `actionCopyAsPng` (`actionClipboard.tsx@1118751f:192`) and `actionCopyAsSvg` (`:124`) both call
 * `prepareElementsForExport(elements, appState, true)`, the literal `true` in both at `:139` and
 * `:212`. An empty selection copies the whole scene; a lone selected frame copies that frame's
 * contents; neither is decided a second time.
 *
 * The chord is the raster's alone. `actionCopyAsSvg` declares no `keyTest` at all — the action
 * ends at `keywords` at `:190` — so Alt+Shift+C copies a PNG and the SVG has no shortcut at all.
 *
 * These are the third, fourth and fifth `why`s in this project that named a task number and went
 * false the moment the task merged. The test noticed, which is the only reason the count did not
 * quietly claim them twice.
 */
const CLOSED_BY_P43: ReadonlyArray<[string, number, string]> = [
  ["shortkey.md", 436, "Copy PNG to clipboard"],
  ["shortkey.md", 448, "Copy selection as PNG"],
  ["shortkey.md", 449, "Copy selection as SVG"],
];

describe("the export lines p4.1 moved", () => {
  it("closes the whole-scene PNG, the scale and the background toggle", () => {
    for (const [source, line, text] of CLOSED_BY_P41) {
      expect(
        statusOf(source, line),
        `${source}:${line} "${text}" should be covered by this change`,
      ).toBe("covered");
    }
  });

  it("leaves every neighbouring line a gap, because each is another task", () => {
    for (const [source, line, text] of STILL_GAPS) {
      expect(
        statusOf(source, line),
        `${source}:${line} "${text}" belongs to 4.3, 4.5 or 4.6 — not to p4.1`,
      ).toBe("gap");
    }
  });

  it("leaves the selection and frame lines covered, by 4.2", () => {
    for (const [source, line, text] of CLOSED_BY_P42) {
      expect(
        statusOf(source, line),
        `${source}:${line} "${text}" was 4.2's to close, and 4.2 did`,
      ).toBe("covered");
    }
  });

  it("leaves the lines 4.1 named but did not finish covered", () => {
    for (const [source, line, text] of CLOSED_AFTER_P41) {
      expect(
        statusOf(source, line),
        `${source}:${line} "${text}" was still a gap when 4.1 landed, and is covered now`,
      ).toBe("covered");
    }
  });

  it("leaves the clipboard lines covered, by 4.3", () => {
    for (const [source, line, text] of CLOSED_BY_P43) {
      expect(
        statusOf(source, line),
        `${source}:${line} "${text}" was 4.3's to close, and 4.3 did`,
      ).toBe("covered");
    }
  });

  it("records the background line as half done rather than claiming it", () => {
    // shortkey.md:450 — "Include/exclude background depending on export settings". The PNG
    // half is real; the SVG half is not (scene_to_svg always draws its <rect>). A rule
    // either closes the sentence or says which half is open, and this one says so.
    const rule = RULES.find(
      (candidate) =>
        candidate.text instanceof RegExp &&
        candidate.text.test("Include/exclude background depending on export settings"),
    );
    expect(rule, "the background line should still be a rule").toBeDefined();
    expect(rule?.status, "and it should still be a gap").toBe("gap");
    expect(rule?.why, "which should name the half that is done").toMatch(/PNG export honours it/);
    expect(rule?.why, "and the half that is not").toMatch(/scene_to_svg still always renders/);
  });
});
