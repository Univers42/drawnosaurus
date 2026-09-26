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

## Known limits

- Focus mode frames the shape that was selected when Enter was pressed, not the caret —
  a very tall or wide label can still overflow the margin vertically once typed.
- The 250ms zoom ease and the 80%/2× focus numbers are this project's own picks, not
  ported from the oracle (see the citations above); tune in `style.rs`/`camera.ts` if they
  read wrong in practice.
