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

## `boundsOf` normalises a mirrored element

`boundsOf` (`camera.ts`) is the front's only source of a set of elements' union box, and it
read `x + width` as an element's right edge. A **mirrored** element — `width` or `height`
under zero, which the engine leaves behind the moment a resize drag crosses the anchor
(`selection/transform.rs:175-198`) — therefore came back as a box whose min is past its max,
which every consumer reads as empty or inverted.

It normalises each element through `elementBounds`
(`packages/contract/src/bounds.ts:35-44`) — the sanctioned mirror of the engine's
`normalize_rect` (`scene/geometry.rs:14-21`), which is what gives a rect dragged up and to
the left bounds at all. The front keeps no arithmetic **of its own for the normalisation**:
`presentation.ts` already reaches for the same function. It still accumulates the union with
four `Math.min`/`Math.max`, and it is still on §2's list — see below. On an element that is
**not** mirrored the call is the identity, so no well-behaved rect moves; `camera.test.ts`
pins that on its own, with a fractional width and height among the literals.

**Three call sites, four consumers, and what each one reads.** All three calls are in
`DrawSurface.svelte`; one of them drives a consumer of its own, so four things read this box.

| call site                                                | what it reads                                                                  | a mirrored element moved it by                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------- |
| `DrawSurface.svelte:1085` `updateFlowchartStripPosition` | the cluster's centre-x and its **top**                                         | the strip sat on the node instead of above it      |
| `DrawSurface.svelte:1126` `placeShapeSwitch`             | `switchPanelAt` (`shapeSwitch.ts:48`) — the selection's **bottom-left** corner | the panel hung above the shape instead of under it |
| `DrawSurface.svelte:1293` `enterFocusMode`               | `focusCamera` — the **width** and the centre                                   | the scale, on a selected text element (below)      |

Two of the three are pinned in a browser, and each has its own case:

- **The strip.** A pending node copies the start node's extents verbatim
  (`flowchart.rs:356-357`), so a start node whose own width and height are negative makes a
  pending node negative too, and `bounds.y` is that node's _bottom_. The strip — which is
  meant to sit above the node being created — sat on it, its foot 42px below the cluster's
  top edge. `flowchart.spec.ts` › "the shape strip sits above a mirrored pending node, not on
  it".
- **The panel.** `switchPanelAt` reads `bounds.y + bounds.height`, the selection's bottom
  edge, which for a negative height is its _top_; the panel hung above the shape instead of
  under it. `shapeSwitch.spec.ts` › "a mirrored shape hangs the switch under its bottom-left
  corner", and `mirrored-panel.png` in the evidence shows it.

**Focus mode is the third, and it is a camera bug rather than a bounds one.** A _shape_ on
Enter is not a case at all: `edit_selected_text` opens the shape's **label** and selects that
(`text.rs:184-186`, `text.rs:338-340`), and a label's geometry is written from the text
layout, which is never negative. A **selected text element** on Enter is a case — see the
known limit at the end of this page.

**This is not the law-3 line closed.** The finish is an engine method that returns the union
bounds of a _caller-chosen id set_ — `zoom_to_fit_selection` fits the current selection, and
`pendingFlowchartElements` has no method at all — with the front calling it and this host
copy deleted. That is a separate item; until it lands `boundsOf` stays here, and fixing its
normalisation does not move the arithmetic anywhere.

## Where the host's camera formulas come from

Since `1334bcf` the front imports them rather than keeping its own: `worldToScreen`,
`screenToWorld` and `MIN_ZOOM`/`MAX_ZOOM` from `@osionos/draw-engine/cameraMath`, and the
grid default from `DEFAULT_GRID` in `/types`. The host's own
`apps/web/src/lib/draw-chrome/camera.ts` used to export a second `worldToScreen` and its
own zoom pair, and `DrawSurface.svelte` did `screen_to_world` by hand at two call sites.
That read against law 3's "the front must never re-implement an engine formula in
TypeScript", so it is worth being exact about what replaced it.

**The four values are WASM exports of `camera.rs`.** `world_to_screen` (`camera.rs:147`),
`screen_to_world` (`:154`) and the zoom limits (`:5-6`) are bound in
`engine/crates/draw-engine/src/wasm/camera_api.rs` and reach the host through
`engine/src/cameraMath.ts`, which computes nothing: each function forwards to the glue and
returns what it says. `engine/src/camera.ts` — the hand-kept mirror that stood here until
this commit, and `MIN_ZOOM`/`MAX_ZOOM` as the literals `0.1` and `30` in
`engine/src/types.ts` — are gone, and `DrawEngine.screenToWorld`
(`engine/src/engine.ts:164`) no longer writes the expression out a third time either.

**They are free functions, not `DrawEngine` methods,** and that is forced by the callers
rather than chosen: a peer's cursor, the shape-switch panel and a presentation path badge
all hold a `Camera` and have no engine, and a method would mean a `cameraJson` call and a
`JSON.parse` per point on a path that runs per frame. They take the camera as three
numbers and answer with a `Float64Array` of two, so nothing is copied to JS except the
answer.

**`cameraMath.ts` is the wrapper, and the arithmetic must not go back into it.**
`apps/web/src/lib/draw-chrome/cameraParity.test.ts` is what holds that: it reads
`camera.rs` and then goes looking for the expressions in `engine/src/**` and
`apps/web/src/**`, so a hand-written `world_to_screen` reappearing — under any local names,
which is how the old mirror hid it by returning `{sx, sy}` — fails with the file and line,
as do the two zoom limits as their own literals. It also pins the four Rust values to the
lines cited above, so moving one is a deliberate edit rather than a silent drift. The
arithmetic as _behaviour_ is pinned in Rust, in
`engine/crates/draw-engine/tests/ci_camera.rs`.

**Unit tests reach the WASM.** The web's vitest suite runs in node, where the app's
`loadDrawEngine()` cannot work — it is a `fetch` of a sibling `.wasm` — so
`apps/web/test/vitest.setup.ts` instantiates the module from its bytes with `initSync` before
each file. That is why `make test` now depends on `engine/pkg` (as `typecheck` already
did) and why CI's `test` job takes the `engine-pkg` artifact. Without it a test of the
front's camera maths could not call the engine at all.

Where the front must keep the arithmetic out of the loop entirely — a per-frame path that
already holds the camera — prefer the free function over `DrawEngine.screenToWorld`. The
method now forwards to the same WASM export, but it reads the camera through the `camera`
getter (`engine/src/engine.ts:69`), which crosses into Rust for `cameraJson` and parses the
result back in JS; on the peer-cursor path that is a WASM hop and a `JSON.parse` per
frame, which is what the note above that path is about.

## Known limits

- Focus mode frames the shape that was selected when Enter was pressed, not the caret —
  a very tall or wide label can still overflow the margin vertically once typed.
- **A selected _text element_ that has been mirrored enters focus mode zoomed to the 2×
  cap instead of being framed.** Enter on a selected text element takes the
  `single.kind == Text` branch of `edit_selected_text` (`text.rs:20-22`), which requests the
  edit and leaves the selection on that element, and a text element's geometry is written
  straight from `resize_element_within` (`pointer_move.rs:756-768`), which returns a
  negative extent once a handle crosses the anchor (`selection/transform.rs:183-198`).
  `focusCamera` then divides the viewport by `Math.max(bounds.width, 1)`
  (`camera.ts:307`) — before the normalisation it read a negative width, so the fit was
  computed from 1 world pixel and clamped to the cap. **Repro:** draw a text element, drag
  a side handle past the opposite edge so `width` goes negative, select it, press Enter: the
  camera lands at 2× with the text running off the sides, where a 400px-wide element should
  sit at about 1×. `boundsOf` now hands over a correct box, so the remaining fault is
  `focusCamera`'s own `Math.max(bounds.width, 1)` guard — a camera concern, not a bounds
  one, and **not fixed here**: it is a separate item.
- The 250ms zoom ease and the 80%/2× focus numbers are this project's own picks, not
  ported from the oracle (see the citations above); tune in `style.rs`/`camera.ts` if they
  read wrong in practice.
