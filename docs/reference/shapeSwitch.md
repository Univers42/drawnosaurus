# Shape switch

Tab switches the selected rectangles, diamonds and ellipses to another of the three, and the
selected lines and arrows between line, sharp, curved and elbow. This is both branches of
Excalidraw's `ConvertElementTypePopup`
(`packages/excalidraw/components/ConvertElementTypePopup.tsx@1118751f`, keys at
`App.tsx@1118751f:5543-5572`).

## What the keys do

- With the board focused and something switchable selected, the first Tab or Shift+Tab
  opens the panel. It switches nothing.
- Each Tab after that switches the selection forward, and each Shift+Tab switches it back.
  - Closed shapes go rectangle → diamond → ellipse → rectangle. Linear types go
    line → sharp arrow → curved arrow → elbow arrow → line.
  - A mixed selection has no shared type, so it lands on the first of the family (Tab) or
    the third (Shift+Tab).
  - **A closed shape wins a mixed selection.** With a rectangle and a line selected, Tab
    walks the rectangle and leaves the line alone
    (`ConvertElementTypePopup.tsx@1118751f:648-653`).
  - Anything else in the selection is left alone.
- A click on a type switches to it, and focus stays on the board.
- Escape, a press on the canvas, or a selection with nothing switchable closes the panel.
- Each switch is one step of undo.

## What a switched shape keeps

- The shape keeps its id, place, size, style and roundness on or off. An explicit corner
  radius is dropped, as the oracle drops `roundness.value`.
- **Its label** is laid out again at the size it had when the panel opened, then shrunk
  until it fits (`text/layout.rs` › `fitting_font_size`). It grows back when the shape
  comes round again, but only while the panel stays open.
- **Its arrows**:
  - An end that is off the new outline moves along the ray from the centre to where
    that ray crosses the outline (`scene/binding.rs` › `reanchor_to_outline`).
  - An elbow end is re-fixed.
  - Then every arrow is routed again.

## What a switched line or arrow keeps

- **Its id**, so every binding elsewhere that points at it still finds it.
- **Its points, its place and its bounds, its group and its style.**
- **Its bindings — because the switch never runs on an element that has any.** An arrow
  with a bound end or a label is not switchable at all, so Tab does not open the panel
  for it: the oracle's `isEligibleLinearElement`
  (`ConvertElementTypePopup.tsx@1118751f:666-672`) refuses it, and so does
  `can_convert_selection`. A switch cannot break a binding because it never sees one.
- **Its heads, in two cases only:**
  - to a **line**, both heads are cleared — the oracle's `newLinearElement` writes them to
    null whatever the element carried (`packages/element/src/newElement.ts@1118751f:583-586`).
  - to a **sharp or curved arrow**, the heads are the toolbar's current choice, not the
    element's (`ConvertElementTypePopup.tsx@1118751f:891-892`, `:905-906`).
  - to an **elbow**, the element's own heads, and the head at the end is forced to `arrow`
    (`:910-919`, `:591-594`).
  - **back to a type it has been in**, the whole remembered element comes back, heads and
    all (`:551-556`).

### The round trip

Switching a line to an arrow and back gives the line it started as: same id, same points,
same bounds, same group, same bindings. That is not recomputed, it is **remembered** — the
panel keeps each selected line or arrow under the type it has
(`LINEAR_ELEMENT_CONVERSION_CACHE`, `ConvertElementTypePopup.tsx@1118751f:157-161`,
filled at `:280-292`), and returning to a remembered type hands the element back whole
(`:551-556`). The cache lives exactly as long as the panel is open.

The **elbow** is the one conversion that changes the points: it is not a type swap but a
**re-route** between the same two ends, orthogonal (`:567-594`, `convertLineToElbow`).
Coming back off it restores the remembered points rather than un-routing the runs.

## Where we differ

- **Tab is not trapped.** The oracle takes Tab from the board whatever is selected. Here
  it moves focus on when there is nothing to switch, so the board is never a keyboard
  trap.
- **Panel position.** The panel hangs under the selection's unrotated bottom-left corner.
  The oracle turns that corner for a single rotated shape. The corner comes from
  `boundsOf`, in `DrawSurface.svelte` › `placeShapeSwitch` — the **fourth** consumer of that
  box, after the flowchart strip and focus mode, and the reason a mirrored shape used to
  hang the panel off its own far corner. `docs/reference/camera.md`.
- **A line with bindings is refused, the oracle converts it.** Nothing here can give a
  line a binding — `drop_binding` answers `None` for anything that is not an arrow
  (`engine/pointer_move.rs:461`) — but a board can hold one, loaded from a file, and the
  oracle's constructor would drop the binding while the shape's `boundElements` kept
  pointing at an arrow bound to nothing. We refuse instead, as we refuse a bound arrow.
- **The elbow is routed by the engine's one elbow router**, the same code
  `actionChangeArrowType` uses here (`scene/elbow` › `retype`), rather than by a second
  port of the oracle's `convertLineToElbow`. One router, 2000-odd tests behind it.
- **The cache is filled when the panel opens**, not on every render as the oracle's panel
  does. It differs only for a type reached _and_ left again inside one sitting of the
  panel: rebuilt here, handed back whole there, and the same once the step is stamped.
- **A click is one step of undo here.** The oracle's popup click path
  (`ConvertElementTypePopup.tsx@1118751f:349-359`) never calls `scheduleCapture`, so a
  conversion made by clicking a type rides whatever capture comes next; only the keyboard
  path stamps (`App.tsx@1118751f:5564`). Ours stamps on both.

Code: `engine/convert.rs` (the switch), `apps/web/src/lib/draw-chrome/shapeSwitch.ts`
(keys and which types the panel offers), `ShapeStrip.svelte` (the panel). Tests:
`ci_shape_convert.rs`, `shapeSwitch.test.ts`, `e2e/shapeSwitch.spec.ts`.
