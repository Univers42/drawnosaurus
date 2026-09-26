---
name: canvas-engine
description: >
  How the drawing engine's camera, keyboard shortcuts, arrow bindings and their tests fit
  together, and how to check a change to them against Excalidraw. Auto-triggers on:
  "camera", "zoom", "pan", "fit", "shortcut", "keyboard", "binding", "arrow bound",
  "flowchart", "frame time", "perf budget", "canvas engine"
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

# Canvas engine

The spec is Excalidraw at the SHA in `scripts/oracle-sha.txt` (`make oracle` fetches it into
`third_party/excalidraw`). Read the oracle's code before changing behaviour; cite it as
`file@1118751f:line` in the comment beside the port. Never guess the UX.

Rust paths below are under `engine/crates/draw-engine/` (`src/…`, `tests/…`); TS host paths
under `engine/src/`.

## Camera math

One camera, `Camera { x, y, scale }` (`src/camera.rs`):

```
screen = world * scale + (x, y)        world_to_screen
world  = (screen - (x, y)) / scale     screen_to_world
```

- **Zoom at a point** (`zoom_to`): keep the world point under `(sx, sy)` fixed:
  `x' = sx - (sx - x) * s'/s`, same for `y`. Pinned by `tests/ci_zoom_wheel.rs` and
  `e2e/zoom.spec.ts` ("the point under the cursor stays").
- **Limits**: `normalize_zoom` = the oracle's `getNormalizedZoom`: round to 6 places, clamp
  to `MIN_ZOOM` 0.1 … `MAX_ZOOM` 30.
- **Steps**: the wheel steps geometrically (`ZOOM_STEP`, a proportion of the current scale)
  where the oracle adds a flat tenth. This divergence is deliberate and documented in situ.
  Ctrl +/- step ×1.2, and Ctrl 0 resets to 1.
- **Wheel** (`host/wheel.ts`): a plain wheel pans and Ctrl/⌘+wheel zooms at the
  cursor. Lines and pages are converted to pixels first, because the oracle forgets
  `deltaMode`. Space+drag, a middle-button drag and H all pan (`host/pointerInput.ts`).
- **Fits** (`src/camera.rs` › `zoom_to_fit_bounds`, the oracle's `zoomToFitBounds` +
  `centerScrollOn`):
  - The room is the viewport minus the chrome's `Offsets` plus 24px (`room_offsets`).
  - `ScaleDown` fits the bounds but never zooms past 1; `Contain` zooms to fill.
  - The camera centres the bounds in the room: `x = ((w - right)/2 + left/2) - cx*zoom`.
  - Shift+1 `zoom_to_fit` fits all elements, `ScaleDown`.
  - Shift+2 `zoom_to_fit_selection_in_viewport` fits the selection (all if nothing is
    selected), `ScaleDown`.
  - Shift+3 `zoom_to_fit_selection` fits the selection (all if nothing), `Contain`.
  - An empty board fits `[0,0,0,0]`, as the oracle does.
  - Tests: `tests/ci_zoom_fit.rs` (hand-worked cameras on 800x600) and `e2e/shortcuts.spec.ts`.
- **Chrome offsets**: surfaces marked `data-viewport-ui="top|bottom|side"` are measured by
  `apps/web/src/lib/draw-chrome/viewportOffsets.ts`. `DrawSurface.svelte` › `measureRoom`
  measures them at the keypress or click that moves the camera, then calls
  `engine.setViewportOffsets`. Any new camera command that fits or reveals must measure
  first.
- **Easing**:
  - `animate_camera_to` eases fits and zooms over `CAMERA_ZOOM_MS` (250) and the flowchart
    reveal over `CAMERA_REVEAL_MS` (300). The oracle jumps on these; the ease is our addition.
  - Reduced motion lands the move in one frame. Browser specs about where the camera lands
    call `page.emulateMedia({ reducedMotion: "reduce" })`, or wait on
    `waitForCameraStable` (`e2e/board.ts`).
  - The wheel is instant, as in the oracle.

## Rendering budget

- Frames render only when `needs_frame()` says so (`src/wasm/mod.rs` › `schedule`).
- The static layer is a cached bitmap: an unchanged frame is a `reuse`, a pan scrolls it,
  and anything else redraws it. Culling keeps off-screen elements out of the display list.
- Measure **our CPU per frame**, never the rAF interval, which under SwiftShader (no
  `/dev/dri` here or in CI) measures the compositor. Use
  `debugSnapshot().rendering`:
  - `p95CpuMs`: build + paint;
  - `p95PaintMs` and `medianBuildMs`;
  - `redraws` / `scrolls` / `reuses`: the plan counts, read these first;
  - `elementsRendered`: what culling kept.
- The window is the last 120 frames, so a measured gesture must ask for more than that.
- The gate is `e2e/cameraBudget.spec.ts`: 2,000 shapes, pan and zoom, `p95CpuMs < 16.7`.
  It logs both phases. `make parity` compares the same gestures against Excalidraw and is a
  measurement, not a gate.

## Shortcuts

- Engine keys live in `host/keys.ts`, tested by `keys.test.ts` with a recording
  mock: add the method to the mock, then assert the call list.
- Chrome-level keys live in `DrawSurface.svelte`'s editor keydown capture. That capture runs
  before the engine's listener, which is why offsets are measured there.
- The command palette (`commandPalette.ts`) is a pure list over a `PaletteHost`. Every
  entry names its shortcut through `shortcutLabel`. Labels follow the oracle's `en.json`.
- The key listener sits on the editor container, not the window. Browser specs call
  `focusBoard()` before pressing keys. It clicks the canvas, which clears the selection, so
  select afterwards with `clickElement()`.

## Arrow bindings

- An element-level bind stores the target id plus a fixed point on it. Elbow arrows route
  through `src/scene/elbow/` (`bind_and_route` binds both ends, then routes over a `Board`).
- A flowchart link (Ctrl+Arrow) is an elbow arrow 6px off the side middles
  (`src/engine/flowchart.rs`, `ARROW_PADDING`).
- Replayed against the oracle's own output by `tests/ci_flowchart_oracle.rs`. The fixtures
  are regenerated by `make oracle-fixtures`, only when the pin moves.
- Every local edit must move the element's stamp (`src/engine/stamp.rs`). That stamp is the only
  change signal autosave and peers have.

## Running the checks

| What                          | Command                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| one engine test file          | `cd engine && docker compose run --rm --no-deps --entrypoint sh draw-engine -lc 'cargo test -p draw-engine --test ci_zoom_fit'` |
| engine TS (keys, wheel)       | `cd engine && make test`                                                                                                        |
| rebuild WASM after Rust edits | `make wasm`                                                                                                                     |
| web unit tests                | `pnpm --filter @drawnosaurus/web exec vitest run src/lib/draw-chrome/commandPalette.test.ts`                                    |
| one browser spec              | `pnpm exec playwright test e2e/cameraBudget.spec.ts --trace=off`                                                                |
| checklist coverage            | `make conformance` — a `prompt/*.md` line changes → a registry rule changes                                                     |

- In a worktree, set `COMPOSE_PROJECT_NAME` per worktree for engine commands. Nested
  `engine/` dirs otherwise share one compose project and cargo target.
- Browser specs stub `/v1/**` and the websocket (`e2e/board.ts` › `openBoard`, which also
  serves a `scene`). They run at a fixed 1280×800 viewport with no retries. Start gestures
  inside `OPEN_CANVAS`, because the chrome floats over the canvas.
- A visual check is a screenshot of the running page; judge it against the oracle doing the
  same thing.
