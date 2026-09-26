# Shape switch

Tab switches the selected rectangles, diamonds and ellipses to another of the three.
This is the generic branch of Excalidraw's `ConvertElementTypePopup`
(`packages/excalidraw/components/ConvertElementTypePopup.tsx@1118751f`, keys at
`App.tsx@1118751f:5543-5572`).

## What the keys do

- With the board focused and a switchable shape selected, the first Tab or Shift+Tab
  opens the panel. It switches nothing.
- Each Tab after that switches the selection forward (rectangle → diamond → ellipse →
  rectangle), and each Shift+Tab switches it back.
  - Mixed kinds all become the first type (Tab) or the second (Shift+Tab).
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

## Where we differ

- **Tab is not trapped.** The oracle takes Tab from the board whatever is selected. Here
  it moves focus on when there is nothing to switch, so the board is never a keyboard
  trap.
- **Panel position.** The panel hangs under the selection's unrotated bottom-left corner.
  The oracle turns that corner for a single rotated shape.
- **Not ported:** the linear branch, which switches lines and arrows between sharp,
  curved and elbow.

Code: `engine/convert.rs` (the switch), `apps/web/src/lib/draw-chrome/shapeSwitch.ts`
(keys and placement), `ShapeStrip.svelte` (the panel). Tests: `ci_shape_convert.rs`,
`shapeSwitch.test.ts`, `e2e/shapeSwitch.spec.ts`.
