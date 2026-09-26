import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures.ts";
import { openBoard } from "./board.ts";
import type { Case } from "./mermaid/generators.ts";
import { TYPES } from "./mermaid/types.ts";
import { check, type Placed } from "./mermaid/checks.ts";
import { REGRESSIONS } from "./mermaid/regressions.ts";

/**
 * Seeded Mermaid definitions of every type, each converted by the app's own path — the
 * oracle's converter, then `engine.insertJson` as the dialog's Insert places it — and
 * held to `mermaid/checks.ts`. A failure names its type and seed; add the seed to
 * `mermaid/regressions.ts` and it runs on every pass after.
 *
 * `MERMAID_FUZZ_CASES` seeds per type: a handful in the ordinary suite, a thousand under
 * `make fuzz-mermaid`.
 */

const CASES = Number(process.env.MERMAID_FUZZ_CASES ?? 5);
/** Definitions converted per round trip into the page. */
const BATCH = 20;

type Outcome = { converted: Placed[]; placed: Placed[] } | { error: string };

/** Converts and places each definition on an emptied board; what came out, pictures reduced. */
function convertAll(page: Page, sources: string[]): Promise<Outcome[]> {
  return page.evaluate(async (sources) => {
    const engine = window.__drawEngine!;
    const convert = window.__mermaidToElements!;
    // A picture is megabytes of base64; whether there is one is all the checks read.
    const reduce = (elements: Record<string, unknown>[]) =>
      elements.map(({ dataUrl, ...rest }) => ({
        ...rest,
        hasPicture: typeof dataUrl === "string" && dataUrl.startsWith("data:image/"),
      }));
    const out: unknown[] = [];
    for (const source of sources) {
      try {
        const converted = await convert(source);
        engine.clear();
        const json = JSON.stringify({ type: "osidraw", version: 1, elements: converted });
        if (!engine.insertJson(json, { x: 0, y: 0 })) {
          out.push({ error: "the engine refused the elements" });
          continue;
        }
        const placed = (JSON.parse(engine.exportJson()) as { elements: Record<string, unknown>[] })
          .elements;
        out.push({ converted: reduce(converted), placed: reduce(placed) });
      } catch (error) {
        const e = error as { name?: string; message?: string };
        out.push({ error: `${e.name ?? "Error"}: ${e.message ?? String(error)}` });
      }
    }
    return out as never;
  }, sources);
}

for (const [type, { conversion, generate }] of Object.entries(TYPES)) {
  test(`mermaid ${type}: ${CASES} seeded definitions come out whole`, async ({ page }) => {
    const seeds = [
      ...new Set([...(REGRESSIONS[type] ?? []), ...Array.from({ length: CASES }, (_, i) => i + 1)]),
    ];
    test.setTimeout(60_000 + seeds.length * 3_000);
    await openBoard(page);

    const failing: string[] = [];
    for (let at = 0; at < seeds.length; at += BATCH) {
      const batch = seeds.slice(at, at + BATCH);
      const cases: Case[] = batch.map((seed) => generate(seed));
      const outcomes = await convertAll(
        page,
        cases.map((kase) => kase.source),
      );
      outcomes.forEach((outcome, i) => {
        const failures =
          "error" in outcome
            ? [outcome.error]
            : check(conversion, cases[i]!, outcome.converted, outcome.placed);
        if (failures.length > 0) {
          failing.push(`seed ${batch[i]}: ${failures.slice(0, 3).join("; ")}`);
          if (failing.length === 1) failing.push(`  source:\n${cases[i]!.source.slice(0, 1500)}`);
        }
      });
    }
    expect(failing, `${type}: failing seeds`).toEqual([]);
  });
}
