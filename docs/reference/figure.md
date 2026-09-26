# Figures

Markers: **OBSERVED**, **VERIFIED**, **INFERRED**, **IMPLEMENTATION DETAIL**, **UNKNOWN**.

**No oracle equivalent.** Excalidraw's shapes are either a fixed primitive (rectangle,
diamond, ellipse) or a free-drawn path; there is nothing in the pinned oracle
(`scripts/oracle-sha.txt`) that this element ports. It is a project-original addition,
deliberately in between: a handful of named silhouettes, each with the one number that
changes its character.

## One element, one pure function

**VERIFIED** — a `figure` is one element carrying `figure: { kind, sides?, ratio? }`
(`scene/figure.rs`). `kind` is one of `polygon | star | parallelogram | trapezoid |
cylinder | document`; `sides` (3-12) is the polygon's or star's point count; `ratio`
(0.05-0.95, narrower per kind — see below) is the one shape parameter each other kind
takes. Both are optional: absent means the kind's own default, resolved by
`figure::resolved_sides` / `figure::resolved_ratio`, never stored back until something
actually sets them.

`figure::outline(kind, sides, ratio)` is the single source of the shape: a closed ring in
element-local **unit-box** coordinates (`0..=1`, top-left origin — the same box
`scene::geometry::local_box` describes for every other shape) plus, for the cylinder
alone, one extra open stroke (the front arc of its top ellipse). Everything that needs a
figure's geometry scales this by the element's own width and height and calls it fresh —
paint (`render/shape.rs`, `wasm/paint.rs`), the selection outline (`render/outline.rs`),
hit testing and rotation handles (`scene/geometry.rs`), SVG export (`export/svg.rs`) and
the label's inset box (`text/layout.rs`) — so the outline is defined exactly once and
every consumer stays in sync with it by construction. A figure is `is_rect_like`: it
binds arrows to its real outline, takes a bucket fill, resizes, flips, duplicates and
copy/pastes like a rectangle or a diamond, because nothing in those paths reads a fixed
primitive — they all go through the same shape geometry a figure now also provides.

A figure's own controls — kind, sides and ratio — reuse the existing style-patch pipeline
rather than adding dedicated methods: `figure_kind` / `figure_sides` / `figure_ratio` are
three more fields on `DrawElementStylePatch` / the web's `StylePatch`, applied by the same
`apply_style` / `preview_style` every other row goes through, so the inspector's ratio
slider previews live and commits once on release exactly as opacity does, and the sides
stepper and the kind row are each one undo step like any other pick. A sides/ratio patch
is ignored on a kind with no such control (`figure::has_sides` / `has_ratio`); a kind
change (`figure::change_kind`) keeps `sides` only between two kinds that both have one
(polygon ↔ star) and always resets `ratio` to the new kind's own default, since it means a
different thing on every kind that has one.

A kind, sides or ratio change relays out a bound label the same way a resize does
(`figure_text_inset_fraction` reads all three) and re-resolves any arrow bound to the
figure's outline (`apply_bindings`, `scene/binding.rs::refresh_bindings_in_place`), both as
part of the same undo step — see `engine/selection_style.rs::apply_style`/`preview_style`.

## The label's inner box

**VERIFIED** (`text/layout.rs::figure_text_inset_fraction`) — a label is laid out inset
from the figure's bounding box, the inset a fraction of the axis it narrows:

| kind                      | inset                                                             |
| ------------------------- | ----------------------------------------------------------------- |
| polygon, ≥5 sides         | both axes, `0.5 * (1 - 1/√2)` — the corner a regular polygon cuts |
| polygon (3-4 sides), star | both axes, a flat 0.25                                            |
| parallelogram, trapezoid  | width only, the shape's own `ratio`                               |
| cylinder, document        | height only, the shape's own `ratio`                              |

Growing a figure to fit a label (`container_dimension_for_bound_text`) inverts the same
fraction, so the two stay consistent whichever direction the layout runs.

## The Shapes tool and its picker

**VERIFIED** — U (no oracle key to take). Like every other shape tool, a figure is
drafted 0×0 at the press and discarded if the gesture never grows past a couple of pixels
(`engine/pointer_end.rs::end_draft`); a real drag keeps it, selected, tool released back
to Select.

The kind the tool draws next is engine-owned state, `next_figure` (`FigureParams`), set by
`setNextFigure`/read by `getNextFigure` — queued by the toolbar and by the command
palette's insert commands below, never touching whatever is selected, because inserting a
fresh shape must not restyle one already on the board.

The inspector's kind row (`InspectorIconChoice`, `FIGURE_KIND_OPTIONS`) is offered for the
tool or a selected figure alike (`forToolOrSelection`), but mirrors `next_arrow_type`'s own
row exactly: a pick goes through the style patch (`figure_kind`), which restyles the
selected figures as one undo step **and** writes `next_figure`'s kind too, so choosing a
kind with figures selected is visible — unlike calling `setNextFigure` directly.

The command palette offers one insert command per kind (`Add polygon`, `Add star`, …),
queuing that kind and then reusing `insertDefaultShape("figure", …)` at the viewport's
centre — the same path `insertShapeAtViewportCentre` uses for a rectangle, diamond or
ellipse.

## Sides and ratio, per kind

**VERIFIED** (`scene/figure.rs::resolved_sides` / `resolved_ratio`) — `has_sides` is true
for `polygon` and `star` only; `has_ratio` is true for everything but `polygon`, which has
none. Defaults and the safe range each kind clamps into (narrower than the contract's own
0.05-0.95 where a wider value would cross the outline over itself):

| kind          | sides default | ratio default | ratio range |
| ------------- | ------------- | ------------- | ----------- |
| polygon       | 6             | —             | —           |
| star          | 5             | 0.5           | 0.05-0.95   |
| parallelogram | —             | 0.25          | 0.05-0.95   |
| trapezoid     | —             | 0.25          | 0.05-0.49   |
| cylinder      | —             | 0.2           | 0.05-0.45   |
| document      | —             | 0.14          | 0.04-0.4    |

`sides` is clamped to the contract's own 3-12 for every kind that has it.

## Flowchart

**VERIFIED** (`engine/flowchart.rs`) — extending a chain from a selected figure with
Ctrl/Cmd+Arrow clones its `figure` params onto the new node unchanged; the digit picker
(1/2/3, rectangle/diamond/ellipse) never offers a figure, so a figure chain only ever
grows by extension, never by a shape switch mid-chain.

## Tests

`engine/crates/draw-engine/tests/ci_figure.rs` pins the geometry, the style patch, bounds,
hit testing, flowchart cloning and export structurally; `packages/contract/tests/
element.test.ts` pins the wire schema; `e2e/figure.spec.ts` is the browser half — the
toolbar and panel actually reach the engine, a real pointer drag binds an arrow to the
outline, and a keyboard-only palette → label → flowchart chain holds together.
