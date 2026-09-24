/**
 * Times vectorizing in Chromium, the way the dialog does it (`bench.js`). From the
 * repository root, after `make wasm`:
 *
 *   TRACE_IMAGES=<a directory of pictures> node perf/vectorize/run.mjs [longest side]
 *
 * Every picture in the directory is traced with each preset at the longest side given —
 * the dialog's `TRACE_MAX_SIDE` when none is — and each trace is inserted both ways.
 * `docs/reference/vectorize.md` has the pictures the documented numbers were taken on.
 *
 * A measurement, not a test: nothing here passes or fails, so no gate runs it.
 */
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const images = process.env.TRACE_IMAGES;
if (!images) throw new Error("set TRACE_IMAGES to a directory of pictures to trace");
const side = process.argv[2] ? Number(process.argv[2]) : undefined;

// The web app's Vite, which already knows how to serve the engine's worker and WASM.
const vite = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { createServer } = await import(pathToFileURL(vite.resolve("vite")).href);
const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: images,
  logLevel: "warn",
  server: { host: "127.0.0.1" },
});
await server.listen();

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (error) => {
    console.error(error);
    process.exitCode = 1;
  });
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForFunction(() => window.ready === true);
  for (const file of readdirSync(images).sort()) {
    const src = `/${encodeURIComponent(file)}`;
    const out = await page.evaluate(([src, side]) => window.bench(src, side), [src, side]);
    console.log(`${file} traced at ${out.width}×${out.height}`);
    for (const run of out.runs) console.log(report(run));
  }
} finally {
  await browser.close();
  await server.close();
}

function report({ preset, config, traceMs, phases, stats, shapes, picture }) {
  const ms = (value) => `${value.toFixed(1)} ms`;
  const split = Object.entries(phases)
    .map(([phase, value]) => `${phase} ${value.toFixed(0)}`)
    .join(" · ");
  const inserted = (insert, as) =>
    insert.refused
      ? `${as}: refused, ${insert.refused}`
      : `${as}: insert ${ms(insert.insertMs)}` +
        (insert.firstFrameMs === undefined ? "" : ` · first frame ${ms(insert.firstFrameMs)}`) +
        ` · 4× frame ${ms(insert.zoomedFrameMs)}`;
  return [
    `  ${preset.padEnd(9)} ${JSON.stringify(config)}`,
    `    trace ${traceMs.toFixed(0)} ms (${split}) · ${stats.shapes} shapes · ` +
      `${stats.regions} regions · ${stats.points} points · svg ${stats.svgBytes} B`,
    `    ${inserted(shapes, "shapes")}`,
    `    ${inserted(picture, "picture")}`,
  ].join("\n");
}
