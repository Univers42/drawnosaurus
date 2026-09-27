/**
 * Instantiates the engine's WASM for the web's unit tests, once per test file.
 *
 * The app reaches the engine through `loadDrawEngine()`, which is a `fetch` of a sibling
 * `.wasm` — a browser's job. These tests run in node (`vite.config.ts`, `environment:
 * "node"`), where there is no such fetch, so the module has to be instantiated from its
 * bytes instead. `initSync` is the call for that, and it works: the engine's exports are
 * plain arithmetic and JSON, none of which touches the DOM.
 *
 * It is here because the front's camera maths is a WASM call now
 * (`@osionos/draw-engine/cameraMath` — `camera.rs:147`, `:154` and `:5-6` over the
 * boundary, in place of the TypeScript mirror that used to sit beside it). A unit test
 * that cannot call the engine cannot test what the front now calls.
 *
 * `engine/pkg` is build output, not source: `make wasm` writes it and `make quality`
 * depends on that, so a test run without it fails here and says so, rather than skipping
 * the cases that need it.
 */
import { readFileSync } from "node:fs";
import { initSync } from "../../engine/pkg/draw_engine.js";

const WASM = new URL("../../engine/pkg/draw_engine_bg.wasm", import.meta.url);

/**
 * A flag rather than a bare `initSync`, because `initSync` does not check whether it has
 * already run: a second call on the same module instance would instantiate a second time
 * and orphan the first. Vitest re-evaluates this file per test file but can share the
 * module graph, so the state has to live somewhere that survives both.
 */
const INSTALLED = Symbol.for("drawnosaurus.web.tests.wasm-installed");

if (!(INSTALLED in globalThis)) {
  initSync({ module: readFileSync(WASM) });
  Object.defineProperty(globalThis, INSTALLED, { value: true });
}
