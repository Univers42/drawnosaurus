# Dynamic size

What is drawn zoomed out looks, on screen, as it would at 100%. A user found drawing at 10%
unusable: a stroke's width is in drawing units, so a freehand line there was 0.2 px wide.
Excalidraw behaves the same way (`getCurrentItemStrokeWidth` ignores the zoom,
`packages/excalidraw/components/App.tsx@1118751f:10432-10437`). **This goes beyond the
oracle, by the owner's decision (2026-10-21):**

- **A "Dynamic size" switch in the main menu, on by default.** Turning it off gives
  Excalidraw's behaviour exactly.
- **Thickness and text scale.** Freehand, lines, arrows, shape outlines and new text.

## The invariant

With the setting on, an element made at zoom `z` is, on screen, the element the same gesture
makes at 100% with the setting off: the same thickness, arrowheads, sloppiness, corners,
dashes and text size. In drawing units it is that element `1/z` times over.
`engine/crates/draw-engine/tests/ci_dynamic_size.rs` checks exactly that, kind by kind: the
canvas's rough sketch and the SVG export of the 10% element must be the 100% one's with every
length multiplied by ten.

## `sizeScale`

One optional element field, `sizeScale` (`size_scale` in Rust).

- It is `1/zoom` at creation, clamped to `[0.1, 10]`, and absent at 100% or with the
  setting off. The clamp keeps a key's width and font size inside the contract's limits
  (`strokeWidth ≤ 100`, `1 ≤ fontSize ≤ 1000`, `packages/contract/src/element.ts`), which
  declares the field so the schema does not strip it.
- `strokeWidth` and `fontSize` are stored **already multiplied**. A reader that ignores
  `sizeScale`, Excalidraw included, still draws the right thickness and text size.
- **An element with no `sizeScale` draws exactly as before.** Every existing drawing keeps
  parity.

## How the look follows it

Not one constant at a time: **the element is drawn as the element it stands for at 100%, and
the result scaled.**

- `render::shape::element_drawable` sketches the unit element (every length divided by the
  scale), then multiplies the ops. rough's jitter, bowing, length gain and hachure, and the
  adaptive corners, follow by construction, and the seed is the element's own.
- A note's outline, shadow and lifted corner (`sticky_path_commands`), its edge shading and
  date footer, and its corner cap do the same.
- The arrowheads' size, both dash patterns (canvas and SVG export) and the adaptive corner
  rule used for hit testing are multiplied by the scale.
- Both shape caches key on the scale.

## Who gets one

- An element a person makes with a tool while the setting is on: freehand, line, arrow,
  rectangle, diamond, ellipse, figure, text, sticky note, frame, and a palette insert.
- **Not pictures or embeds.** Both are already fitted to the view they are placed in
  (`fit_image`), so they look the same on screen at any zoom, and neither has an outline.
  A scale on top made them `1/z` times too big, off the point they were placed at.
- **A label** typed into a shape takes its shape's scale, not the camera's.
- **Flowchart** nodes and their arrows take their source node's.
- **Pasted, duplicated, imported, template and Mermaid** elements keep the scale they came
  with (absent means 1).

## The style panel speaks in keys

The width buttons (thin, bold, extra bold) and the font sizes (S, M, L, XL) show and set the
key relative to each element's scale: a selected element with `sizeScale` 10 and
`strokeWidth` 20 shows **bold** (20 / 10), and picking extra bold sets 40. Copy-styles carries
keys between scales. This is the engine's work (`selection_style.rs`); the panels need none.

## The setting

- **The engine** (`setDynamicSize`, `dynamicSize`) is **off** until its host turns it on, so
  an engine nobody configures makes Excalidraw's elements.
- **The app** keeps the preference per browser in `localStorage`
  (`drawnosaurus:dynamic-size`, `readDynamicSizePreference` in `draw-chrome/theme.ts`),
  **on** unless the word `"false"` is stored, and hands it to the engine when it is ready and
  whenever the switch changes.

## Not covered

- A note's label padding and fit are in drawing units, so a scaled note's label lays out on
  the 100% rules at its own size. The look test covers a one-line label.
- The canvas sketches an arrow's head (`paint_arrowhead_primitive`) with rough options
  that are not scaled. Its size and place follow the scale; its wobble does not, so a head
  drawn at 10% is a little cleaner than at 100%. The SVG export draws heads without rough,
  and matches.

## Tests

- **Engine:** `tests/ci_dynamic_size.rs`, red first (`4c8f282`), then green (`325651b`);
  pictures and embeds red (`e1e30b8`), then green (`812a03c`).
- **Unit:** `theme.test.ts` (the preference), `packages/contract/tests/element.test.ts` (the
  field's range).
- **Browser:** `e2e/dynamicSize.spec.ts` — a stroke at 10% is ten times its key, the switch
  turns it off at once, and a reload keeps the choice.
