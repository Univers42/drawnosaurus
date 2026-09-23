# Interaction model — coordinate spaces and gesture state

## Coordinate spaces

Four, and mixing them is the most common source of "it looks offset".

| space | origin | used by |
|---|---|---|
| screen / client | browser viewport | raw pointer events |
| canvas-local | canvas top-left | `localPoint()`, every engine entry point |
| world | scene origin | the element model, geometry, hit testing |
| element-local | the element's `x`/`y` | `points[]`, the painter inside its transform |

Conversions: `screen_to_world(sx, sy)` and `world_to_screen(camera, wx, wy)`.
Element-local → world is `element.x + point[0]`, except under rotation, where the pivot is
`rotation_center(element)` — the centre of the **points**, not of the box.

A thing measured in **screen pixels** stays constant as you zoom: handle sizes, hit
tolerances, the commit radius for a path. Anything about the hand belongs in screen
pixels and is divided by `camera.scale` to reach world units. A thing measured in
**world units** scales with the drawing.

## Gesture state

One `Option<Interaction>` on the engine — the gesture in progress. Arms include `Draft`,
`TextDraft`, `Linear`, `MultiLinearPress`, `Freedraw`, `Erase`, `Pan`, `Move`, `Resize`,
`Rotate`, `ResizeGroup`, `RotateGroup`, `LinearPoint`, `Lasso`, `Laser`, `Marquee`.

**The rule that matters:** anything a gesture needs to measure from is captured when the
gesture *starts* and held in the arm — `Resize` holds `origin` and `origin_points`,
`Move` holds `origins`, `ResizeGroup` holds a `GroupFrame`. Deriving from the live element
instead compounds: each move transforms state an earlier move already transformed.

A single-move drag cannot detect this. Always test with three or more.

State that must outlive a gesture does **not** go in `Interaction` — it goes on the
engine. A multi-point path spans many press/release cycles, so it lives in
`multi_linear`; the release that places its second point would otherwise throw it away.

## Event delivery

`host/pointerInput.ts` coalesces `pointermove` to one engine step per animation frame.

Moves with **no button held** are normally dropped. The one exception is a multi-point
path being placed, which follows the cursor between clicks — `wantsMove()` gates on it.
If you add another gesture that tracks a free cursor, it goes through the same gate.

Keyboard: the listener is on the editor container, not the window, so an embedding page
keeps its own shortcuts. Nothing has focus until something is clicked — a test that
starts by pressing a key presses it into the void, and `focusBoard()` focuses by
*clicking*, which is itself a gesture.

## Chrome overlays the canvas

The toolbar, inspector and zoom bar are absolutely positioned **on top of** the canvas. A
gesture starting under one never reaches the engine, silently. `OPEN_CANVAS` in
`e2e/board.ts` is the region clear of all of it.
