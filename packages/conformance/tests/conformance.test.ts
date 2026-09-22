import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readChecklists, type ChecklistItem } from "../src/checklist.ts";
import { RULES, ruleFor, type Status } from "../src/registry.ts";

/**
 * The conformance gate.
 *
 * `prompt/shortkey.md` and `prompt/design.md` are what drawnosaurus is being built
 * against. This file is what stops that from being a matter of opinion: every line of
 * them is either covered by a named test file or recorded as a gap with a reason, and
 * both halves are checked rather than asserted.
 *
 * It does not check that the features *work* — the tests it names do that. It checks that
 * the map is honest: nothing unclassified, nothing claiming a test that does not exist,
 * and a count of what is left printed where anyone can see it.
 */

const REPO = join(import.meta.dirname, "..", "..", "..");
const PROMPT = join(REPO, "prompt");

const items = readChecklists(PROMPT);

/** A file that plausibly contains tests, and how many it declares. */
function countTests(path: string): number {
  const source = readFileSync(join(REPO, path), "utf8");
  const rust = source.match(/#\[test\]/g)?.length ?? 0;
  const js = source.match(/\b(?:it|test)(?:\.each\([^)]*\))?\s*\(/g)?.length ?? 0;
  return rust + js;
}

describe("the checklists parse", () => {
  it("finds the documents at all", () => {
    // Guards against the whole suite passing vacuously if `prompt/` moves or is dropped
    // from the repo — every other assertion below iterates the list and would be happy
    // with nothing in it.
    expect(existsSync(PROMPT), `${PROMPT} is missing`).toBe(true);
    expect(items.length).toBeGreaterThan(1000);
  });

  it("reads both documents that carry requirements", () => {
    // `logic.md` is an empty placeholder — one bare `- []` — so it contributes nothing and
    // is not listed. The two that do carry requirements both have to be read, or a whole
    // document could go missing and every count below would still look healthy.
    const sources = new Set(items.map((item) => item.source));
    expect(sources).toContain("design.md");
    expect(sources).toContain("shortkey.md");
  });

  it("keeps the shortcut sections, which start with a backtick", () => {
    // The parser once excluded any line opening with a punctuation character, which
    // silently dropped every `V` — Selection tool style entry: 124 items, and the most
    // concrete ones in either document.
    const essential = items.filter((item) => item.section === "⚡ Essential shortcuts");
    expect(essential.length).toBeGreaterThanOrEqual(15);
    expect(essential.map((item) => item.text)).toContain("`V` — Selection tool");
  });
});

describe("every checklist item is accounted for", () => {
  it("matches a rule", () => {
    const orphans = items.filter((item) => !ruleFor(item));
    const report = orphans
      .slice(0, 40)
      .map((item) => `  ${item.source}:${item.line}  [${item.section}]  ${item.text}`)
      .join("\n");
    expect(
      orphans,
      `${orphans.length} checklist item(s) have no rule in packages/conformance/src/registry.ts.\n` +
        `Add one — a gap with a reason is a fine answer, an unlisted item is not.\n${report}`,
    ).toEqual([]);
  });
});

describe("the registry cannot claim coverage it does not have", () => {
  it("names only test files that exist", () => {
    const missing: string[] = [];
    for (const rule of RULES) {
      for (const path of rule.tests ?? []) {
        if (!existsSync(join(REPO, path))) missing.push(path);
      }
    }
    expect(missing, `named in registry.ts but not on disk:\n  ${missing.join("\n  ")}`).toEqual([]);
  });

  it("names only files that actually contain tests", () => {
    // A file can survive a rename as an empty shell, or be gutted down to helpers. Either
    // way the rule would still point at something real and still cover nothing.
    const empty = (RULES.flatMap((rule) => rule.tests ?? []) as string[])
      .filter((path) => existsSync(join(REPO, path)))
      .filter((path) => countTests(path) === 0);
    expect(empty, `named in registry.ts but declares no tests:\n  ${empty.join("\n  ")}`).toEqual(
      [],
    );
  });

  it("gives every covered rule at least one test", () => {
    const bare = RULES.filter((rule) => rule.status === "covered" && !rule.tests?.length);
    expect(bare.map((rule) => String(rule.section))).toEqual([]);
  });

  it("gives every gap a reason", () => {
    const silent = RULES.filter((rule) => rule.status !== "covered" && !rule.why);
    expect(silent.map((rule) => String(rule.section))).toEqual([]);
  });

  it("has no rule that never matches anything", () => {
    // A dead rule is how a registry rots: the document is reworded, the rule stops
    // matching, and the items it used to cover fall through to whatever is below it.
    const used = new Set(items.map((item) => RULES.indexOf(ruleFor(item)!)));
    const dead = RULES.map((rule, index) => ({ rule, index }))
      .filter(({ index }) => !used.has(index))
      .map(({ rule }) => `${String(rule.section)}${rule.text ? ` /${rule.text.source}/` : ""}`);
    expect(dead, `rules matching nothing:\n  ${dead.join("\n  ")}`).toEqual([]);
  });
});

describe("coverage", () => {
  const tally = (predicate: (item: ChecklistItem) => boolean) => items.filter(predicate).length;
  const withStatus = (status: Status) => tally((item) => ruleFor(item)?.status === status);

  it("reports where the project stands", () => {
    const covered = withStatus("covered");
    const gap = withStatus("gap");
    const outOfScope = withStatus("out-of-scope");
    const inScope = covered + gap;

    // Printed rather than only asserted: the number is the point, and a test that merely
    // passes tells nobody whether it moved.
    const pct = ((covered / inScope) * 100).toFixed(1);
    console.log(
      `\n  conformance: ${covered}/${inScope} in-scope items covered (${pct}%)` +
        `\n  ${gap} gap(s), ${outOfScope} out of scope, ${items.length} lines read\n`,
    );

    expect(covered + gap + outOfScope).toBe(items.length);
    // A floor, not a target. It exists so that deleting tests to make something else pass
    // shows up here as well as there.
    expect(covered).toBeGreaterThan(400);
  });

  it("covers every section that names a tool we ship", () => {
    // The sections a person would try first. Each of these must be `covered` outright —
    // no gap rule may swallow the whole section.
    const shipped = [
      "⚡ Essential shortcuts",
      "🧭 Navigation & canvas",
      "🖱️ Selection",
      "🪣 Bucket fill",
      "🔴 Laser pointer",
      "✋ Hand / panning",
      "🧱 Web embeds",
      "🧠 Autoshape / Smart drawing",
      "📝 Sticky notes",
      "🧩 Frames",
      "🔲 Grid",
    ];
    for (const section of shipped) {
      const inSection = items.filter((item) => item.section === section);
      expect(inSection.length, `${section} has no items — has it been renamed?`).toBeGreaterThan(0);
      const covered = inSection.filter((item) => ruleFor(item)?.status === "covered");
      expect(
        covered.length,
        `${section}: only ${covered.length}/${inSection.length} covered`,
      ).toBeGreaterThan(inSection.length / 2);
    }
  });
});
