/**
 * Client-side only, on purpose.
 *
 * The engine is WASM behind a canvas: its module graph touches `window` and
 * `HTMLCanvasElement` at import time, and there is no meaningful server render of a
 * drawing surface. Rendering the shell on the server would buy nothing and force
 * every engine import to be dynamic.
 */
export const ssr = false;
export const prerender = false;
