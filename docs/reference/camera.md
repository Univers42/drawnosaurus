# Smooth camera and focus mode

Two additions, both eased camera moves, both landing exactly where the instant version
would (see `apps/web/src/lib/draw-chrome/camera.test.ts` and
`engine/crates/draw-engine/tests/ci_style.rs`).

## Zoom and fit now animate

`Shift+1` (fit all), `Shift+2` (fit selection), zoom in/out/reset (`Ctrl/Cmd +`/`-`/`0`) and
the four zoom-bar buttons used to jump. They now ease over 250ms.

**Where it lives, and why:** the keys are dispatched by the engine submodule itself
(`engine/src/host/keys.ts`), which calls straight into WASM (`engine.zoomIn()`,
`engine.fit()`, …), and the zoom-bar buttons (`DrawZoomBar.svelte`) call the identical
methods. One change at the root — `DrawEngine::zoom_in`/`zoom_out`/`zoom_reset`/`fit`/
`zoom_to_selection` in `engine/crates/draw-engine/src/engine/style.rs` now call the
existing `animate_camera_to` (the eased-camera plumbing `DrawEngine::reveal` already used
for the flowchart's commit/navigate) instead of setting the camera directly — covers the
keyboard and the buttons alike, with no second copy of the easing and no change to
`apps/web`. The oracle's own zoom-to-fit actions do not animate at this pinned commit
(`actionCanvas.tsx@1118751f:378-407` computes `zoomToFitBounds` and applies it in the same
tick); only `revealIfHidden` does (`App.tsx@1118751f:5216-5221`, `duration: 300`,
already what `CAMERA_REVEAL_MS` cites). `CAMERA_ZOOM_MS` (250ms) is this project's own
number for the new cases, picked to read as brisk rather than sluggish.

A relative move (zoom in/out/reset) computed mid-flight from the _visual_ camera would
compound onto wherever the ease had only reached so far, dropping a step under a held key
or a fast double-click. `DrawEngine::camera_target` reads the in-flight animation's own end
instead, so repeated presses always land exactly where the same number of instant presses
would.

**`prefers-reduced-motion`:** WASM cannot read `matchMedia`, so `engine/src/host/
bindCanvas.ts` reads it (and its `change` event) and keeps `DrawEngine::set_reduced_motion`
current. Set, every eased camera move — this one and the flowchart's reveal — lands at
once. Wheel and pinch zoom are untouched: they are a finger or a wheel notch tracking in
real time, not a discrete jump, so they were never the thing this asks to be smoothed.

## Focus mode

Pressing **Enter** on a selected shape or text (`prompt/shortkey.md`'s "type in the node")
opens its label and eases the camera so the shape fills the viewport width with an 80%
margin, capped at 2×, and never _below_ the camera's current zoom — entering a shape while
already zoomed in past that must not pull back. Leaving the edit eases back to the camera
from before. A **double-click** does not trigger it: the engine's `onRequestTextEdit`
carries no origin, so `DrawSurface.svelte`'s `onFocusModeKeydown` flags a plain Enter over
the board ahead of the engine's own listener (the same capture-phase technique
`onStyleShortcut` already uses), consumed by the next `onRequestTextEdit` and otherwise
cleared by a `setTimeout(0)` — not a microtask, which the DOM runs after _every_ listener in
one event's dispatch and would clear the flag before the engine's own listener, several
callbacks later in the same chain, ever saw it — so a later double-click is never mistaken
for a keyboard one.

The camera maths is pure — `focusCamera` in `camera.ts` — and reuses `animateCamera`/
`setCameraExact`, the same host-driven ease already used for presentation and the
flowchart's in-progress reveal; no engine change.

Switchable from the main menu ("Focus while typing") and the command palette, **on** by
default, persisted per viewer in `localStorage` (`drawnosaurus:focus-mode`) behind
try/catch — `readFocusModePreference`/`persistFocusModePreference` in `camera.ts`.

## Where the host's camera formulas come from

Since `1334bcf` the front imports them rather than keeping its own: `worldToScreen`,
`screenToWorld` and `MIN_ZOOM`/`MAX_ZOOM` from `@osionos/draw-engine/camera` and `/types`,
and the grid default from `DEFAULT_GRID` in `/types`. The host's own
`apps/web/src/lib/draw-chrome/camera.ts` used to export a second `worldToScreen` and its
own zoom pair, and `DrawSurface.svelte` did `screen_to_world` by hand at two call sites.
That read against law 3's "the front must never re-implement an engine formula in
TypeScript", so it is worth being exact about what replaced it.

**`engine/src/camera.ts` is a TypeScript mirror of the Rust `camera.rs`, not a WASM
binding.** It is a hand-kept copy of `world_to_screen` (`camera.rs:147`),
`screen_to_world` (`:154`), the zoom pair (`:5-6`) and the rest, and the front calling it
calls neither Rust nor WASM. It is not the sanctioned mirror of
`packages/contract/src/bounds.ts` either — that one is pinned to the Rust by tests, and
`engine/src/camera.ts` is not: no test compares it to `camera.rs`, and a change on the
engine side can drift from it silently. `DrawEngine.screenToWorld`
(`engine/src/engine.ts:164`) writes the same expression out a third time, which is the
copy to collapse.

**The real fix is a WASM export — a Rust `#[wasm_bindgen]` for these, a `DrawEngine`
method for each — and that is an engine commit plus a submodule bump, not a web change.**
Until it exists, this import is the closest the front can get to law 3 without one. Do not
undo it on the grounds that it breaks law 3: a formula that is mirrored once and shared is
a smaller offence than the divergent copies it replaced, and the numbers that are still
duplicated live on the engine side, not here.

Where the front must keep the arithmetic out of the loop entirely — a per-frame path that
already holds the camera — prefer the free function over `DrawEngine.screenToWorld`. The
method's arithmetic is TypeScript, but it reads the camera through the `camera` getter
(`engine/src/engine.ts:69`), which crosses into Rust for `cameraJson` and parses the
result back in JS; on the peer-cursor path that is a WASM hop and a `JSON.parse` per
frame, which is what the note above that path is about.

## Known limits

- Focus mode frames the shape that was selected when Enter was pressed, not the caret —
  a very tall or wide label can still overflow the margin vertically once typed.
- The 250ms zoom ease and the 80%/2× focus numbers are this project's own picks, not
  ported from the oracle (see the citations above); tune in `style.rs`/`camera.ts` if they
  read wrong in practice.
