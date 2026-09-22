import { expect, test, type Page } from "@playwright/test";
import { meter, rendererName, sample, stressScenario, summarise, type Result } from "./measure.ts";
import { buildScene, EXCALIDRAW_APP_STATE, type Shape } from "./scene.ts";

/**
 * drawnosaurus against Excalidraw, same browser, same scene, same gestures.
 *
 * Both are served from localhost in dev mode, both are rasterised by the same CPU
 * renderer, and both are charged for main-thread task time by the same CDP counter. The
 * point is a number that can be argued with, not a feeling.
 *
 * Read the caveats in the report this prints before quoting it anywhere. The two are not
 * the same program and a single ratio flatters whichever one is measured on its home
 * ground, so each case is reported separately.
 */

const OURS = process.env.PERF_OURS ?? "http://127.0.0.1:4374";
const THEIRS = process.env.PERF_THEIRS ?? "http://127.0.0.1:3010";

/** Repetitions per case. The first is thrown away as warm-up. */
const REPS = 5;

interface Case {
  count: number;
  shape: Shape;
}

const CASES: Case[] = [
  { count: 200, shape: "small" },
  { count: 1000, shape: "small" },
  { count: 100, shape: "big" },
  { count: 300, shape: "big" },
];

const report: {
  case: string;
  ours: Result;
  theirs: Result;
}[] = [];

/** Loads drawnosaurus with the scene already in it. */
async function openOurs(page: Page, count: number, shape: Shape): Promise<void> {
  const elements = buildScene(count, shape);
  await page.routeWebSocket(/\/live$/, () => {});
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
  await page.waitForFunction(
    (want) => JSON.parse(window.__drawEngine!.exportJson()).elements.length === want,
    count,
  );
  await page.waitForLoadState("networkidle");
}

/** Loads Excalidraw with the same scene, through its own storage. */
async function openTheirs(page: Page, count: number, shape: Shape): Promise<void> {
  const elements = buildScene(count, shape);
  await page.addInitScript(
    ({ els, state }) => {
      localStorage.setItem("excalidraw", JSON.stringify(els));
      localStorage.setItem("excalidraw-state", JSON.stringify(state));
    },
    { els: elements, state: EXCALIDRAW_APP_STATE },
  );
  await page.goto(THEIRS);
  await page.locator("canvas").first().waitFor({ state: "visible" });
  // Their scene lands through React state, so the canvas exists before the elements do.
  await page.waitForFunction((want) => {
    const stored = localStorage.getItem("excalidraw");
    return stored !== null && (JSON.parse(stored) as unknown[]).length === want;
  }, count);
  await page.waitForLoadState("networkidle");
}

async function measure(
  page: Page,
  open: (page: Page, count: number, shape: Shape) => Promise<void>,
  { count, shape }: Case,
): Promise<Result> {
  await open(page, count, shape);
  const box = await page.locator("canvas").first().boundingBox();
  if (!box) throw new Error("no canvas");
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  const m = await meter(page);
  const scenario = await stressScenario(page, centre);
  const samples = [];
  for (let i = 0; i < REPS; i += 1) {
    const taken = await sample(m, scenario);
    // The first pass warms caches on both sides; charging it to either would measure
    // start-up rather than use.
    if (i > 0) samples.push(taken);
  }
  await m.detach();
  return summarise(samples);
}

test.describe.configure({ mode: "serial" });

for (const shape of ["small", "big"] as const) {
  for (const { count } of CASES.filter((c) => c.shape === shape)) {
    test(`${count} ${shape} shapes`, async ({ page }) => {
      test.setTimeout(180_000);
      const ours = await measure(page, openOurs, { count, shape });
      const theirs = await measure(page, openTheirs, { count, shape });
      report.push({ case: `${count} ${shape}`, ours, theirs });

      // Not an assertion about who wins — that is what the numbers are for, and a
      // threshold here would turn a measurement into a wish. This only catches a case
      // that failed to load, which would otherwise report as a suspiciously fast zero.
      expect(ours.taskMs).toBeGreaterThan(0);
      expect(theirs.taskMs).toBeGreaterThan(0);
    });
  }
}

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto(OURS);
  const renderer = await rendererName(page);
  await page.close();

  const ms = (n: number) => `${n.toFixed(1)}ms`;
  const lines = [
    "",
    "  drawnosaurus vs Excalidraw — main-thread task time per scripted stress run",
    `  renderer: ${renderer}`,
    "  lower is better; median of 4 measured runs after a discarded warm-up",
    "",
    "  case            ours      excalidraw   ratio",
    "  ------------------------------------------------",
  ];
  for (const row of report) {
    const ratio = row.theirs.taskMs / row.ours.taskMs;
    const verdict = ratio > 1 ? `${ratio.toFixed(2)}x faster` : `${(1 / ratio).toFixed(2)}x slower`;
    lines.push(
      `  ${row.case.padEnd(14)}  ${ms(row.ours.taskMs).padEnd(9)} ${ms(row.theirs.taskMs).padEnd(
        11,
      )} ${verdict}`,
    );
  }
  lines.push("");
  for (const row of report) {
    lines.push(
      `  ${row.case}: ours script ${ms(row.ours.scriptMs)} / layout ${ms(
        row.ours.layoutMs,
      )} / wall ${ms(row.ours.wallMs)}`,
    );
    lines.push(
      `  ${row.case}: theirs script ${ms(row.theirs.scriptMs)} / layout ${ms(
        row.theirs.layoutMs,
      )} / wall ${ms(row.theirs.wallMs)}`,
    );
  }
  lines.push("");
  console.log(lines.join("\n"));
});
