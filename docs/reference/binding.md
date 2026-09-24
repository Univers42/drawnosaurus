# Binding

Markers: **OBSERVED** (measured in the running editor), **VERIFIED** (read and
measured), **INFERRED**, **IMPLEMENTATION DETAIL**, **UNKNOWN**. Oracle paths are
relative to `third_party/excalidraw/packages/` at the SHA in `scripts/oracle-sha.txt`.

The engine side lives in `engine/crates/draw-engine/src/scene/binding.rs` and
`scene/outline_distance.rs`; its tests are `tests/ci_binding_anchor.rs` (the model),
`ci_binding_dense.rs` (choosing among overlapping shapes), `ci_binding_overlap.rs` (never
inside out), `ci_binding.rs`, `ci_arrow_drag.rs` and `ci_line_multipoint.rs`.

## What an end stores

**VERIFIED** — Excalidraw's "simple" binding (`element/src/binding.ts:644-953`, the
default; the "complex" strategy is behind a feature flag). A bound end is a
`FixedPointBinding` (`element/src/types.ts:316-333`): the shape's id, a `fixedPoint` —
a ratio of the shape's **unrotated** width and height — and a `mode`:

- `inside`: the end sits exactly on the anchor;
- `orbit`: the end aims at the anchor and stops a gap clear of the outline, on the side
  facing where the arrow comes from.

On the wire these are `startFixedPoint` / `endFixedPoint` (`[number, number]`, bounded
to ±10 as the engine clamps) and `startBindMode` / `endBindMode`, beside the existing
`startBinding` / `endBinding` ids (`packages/contract/src/element.ts`). All optional and
undefaulted: an arrow bound before anchors existed carries none of them and reads as the
centre, in orbit — on the same line between the two centres it was always drawn on. Its
ends move by a few units, to Excalidraw's gap, the first time anything on the board is
committed, and that commit restamps it once. `set_anchor` is the only writer of the three
fields, so a released end never keeps an anchor.

**VERIFIED, fixed** — the engine used to store only the id and aim every end along the
line between the two shapes' centres, ignoring `angle`. So a turned shape left its
arrows at a world offset, and an arrow let go beside the corner of a shape arrived at
the middle of the side the centre line happened to cross. The anchor lives in the
shape's own frame (`focus_point` turns it with the shape), so both are gone.

## Where an end binds

**VERIFIED** — `anchor_for_drop` transcribes `binding.ts:644-953`:

| Where the end is let go                     | Binding                           |
| ------------------------------------------- | --------------------------------- |
| nowhere near a target                       | unbound                           |
| near the shape the other end is bound to    | both ends `inside`, where put     |
| inside a shape's outline (fill-independent) | `inside`, exactly there           |
| near one, Alt held                          | `inside`, exactly there           |
| beside one, near a side midpoint (no grid)  | `orbit`, anchored at the midpoint |
| beside one, otherwise                       | `orbit`, projected (below)        |
| Ctrl/Cmd held                               | unbound (`App.tsx:5753-5761`)     |

The projection (`element/src/utils.ts:697-787`) continues the arrow's own line — from
the far anchor for a straight arrow, from the neighbouring point of a bent one —
through the drop until it meets the shape's diagonals (inset 15 from the corners for a
rectangle) or centre lines (anything else); the anchor is that meeting point, or the
drop itself when it misses. So the end arrives along the side it came in on, at the
height it was aimed. With Shift held the far end's orbit anchor is re-projected too, so
the held angle survives (`binding.ts:933-950`). Shift and grid snapping both turn the
midpoint snap off (`binding.ts:876-878`): it would pull the end off the angle or the grid.

"Inside" is the painted outline (`is_inside`, `isPointInElement`,
`collision.ts@1118751f:823-878`): the cut-away of a rounded corner is outside, and so is a
point exactly on the outline — **OBSERVED** on excalidraw.com, a point on a square's edge
binds it in orbit.

A new arrow binds its tail at the press on the same terms
(`App.tsx:10317-10339`). Whether the gesture was a drag or a click is read off the hand —
screen pixels from press to release — never off the arrow, whose bound ends are pulled
onto outlines and can be a few pixels apart, or collapsed, after a long drag. A path
placed click by click finishes when a click binds it in orbit, or beside the shape it
started from; a click _inside_ the chosen shape places a waypoint, so a path can be
routed across shapes (`boundOutsideFromElsewhere` / `endOutsideSameElement`,
`App.tsx@1118751f:10189-10215`; `binding.test.tsx@1118751f:240`, `:259`).

**IMPLEMENTATION DETAIL, deliberate divergence** — the press is judged where it is: the
point the hover just judged, so the outline the hover shows is what the click does
(`ci_binding_dense.rs::the_highlight_is_what_the_click_does`). Excalidraw judges the press
at its preview point (`multiElement.points[last]`, `App.tsx@1118751f:10170`), which its
hover has already moved onto the outline gap of the shape it shows; re-tested there the
point often lands inside another shape, and a click under an orbit outline places a
waypoint instead of finishing. **OBSERVED** on excalidraw.com in a Ctrl+D pack: 13 of 48
probes did that (the oracle finished 8 of 48 clicks, where the same rule judged at the
press finishes every orbit).

**VERIFIED** — a double click one of whose clicks finishes a click-mode path is about
that path, never the shape under the pointer. Excalidraw's finished path is its one
selected element when the `dblclick` arrives, so it is the only container on offer
(`getTextBindableContainerAtPosition`, `App.tsx@1118751f:6831-6838`):

| It finishes              | and lands                         | Opens                   |
| ------------------------ | --------------------------------- | ----------------------- |
| an arrow                 | on it, or within 30 of its middle | a label on the arrow    |
| an arrow                 | anywhere else                     | a free text there       |
| a line                   | anywhere                          | its points, and no text |
| a path too short to keep | anywhere                          | nothing                 |

(`App.tsx@1118751f:7199-7201`, `:7222-7234`, `:7356-7392`; `TEXT_TO_CENTER_SNAP_THRESHOLD`.)
"Anywhere else" happens when the first click finishes, binding in orbit: the end moves
onto the outline, along the line toward the shape's centre, away from the pointer.
**OBSERVED** on excalidraw.com by element id and by the app's state at the `dblclick`: a
second click that finishes on the first's waypoint labelled the arrow, inside a pack and
over an empty board; of five double clicks whose first click bound in orbit, the two
whose end stayed under the pointer labelled the arrow and the three whose end moved away
typed a free text; a line opened its line editor with no text
(`ci_binding_dense.rs::a_double_click_whose_first_click_ends_the_arrow`). The engine used
to open a label on a shape under the pointer. It knows a double click is about the path
by where the finishing press landed (within 35 px, `DOUBLE_TAP_POSITION_THRESHOLD`); a
press anywhere else, a pan or another tool forgets it.

**IMPLEMENTATION DETAIL, deliberate** — dropping one end on the other end's shape makes
both `inside` only while it is there: the other end's binding as the drag found it is
given back when the drag moves on (`bind_dropped_end`). Excalidraw keeps a new arrow's
tail pinned inside for the rest of the drag; nobody drawing across a shape means that.

## Where an end is drawn

**VERIFIED** — `resolve_end` follows `updateBoundPoint` (`binding.ts:1938-2094`): an
`inside` end is its anchor; an `orbit` end runs from its anchor toward the far anchor (a
straight arrow) or its neighbouring point (a bent one) and stops where that line leaves
the outline pushed out by the gap — a box grows into a rounded box, so a corner keeps
the same gap as a side (`intersectElementWithLineSegment`, `collision.ts:627-751`). When
the line never leaves (an anchor the person put outside the shape) the end is its anchor,
as Excalidraw keeps one on its focus (`utils.ts:782-786`, `binding.ts:880`).

**IMPLEMENTATION DETAIL, deliberate divergence** — Excalidraw also sends an orbiting end
_onto_ its anchor when the arrow gets shorter than 10 or its outline point falls inside
the far shape (`binding.ts:2026-2083`). Its anchors mostly sit on the outline, so there
that is a small step; for a centre anchor — every legacy arrow — it was a jump deep into
the shape. Here an orbiting end never enters its shape. What those rules guard against,
an arrow turned inside out, is handled directly: a straight arrow orbiting at both ends
collapses onto its tail when it would run against the line between its anchors, or when
both ends are trapped — each anchor inside its shape with no way out toward the other. An
anchor outside its shape is never trapped. **OBSERVED** on excalidraw.com: one rectangle slid onto
another, the arrow went 228, 128, 48, then 0 long and stayed 0, never entering either.

**IMPLEMENTATION DETAIL, deliberate divergence** — the midpoint snap works from the
press. Excalidraw's check for an arrow with no length (`utils.ts:706-708`) also turns the
snap off at the press while its hover still draws the midpoint dot, a promise the press
then breaks. Only the projection, which needs a direction, waits for one.

## At any depth

**IMPLEMENTATION DETAIL, deliberate divergence** — Excalidraw's gap is `5 + strokeWidth/2`
scene units for every shape (`binding.ts:115-135`). A shape drawn deep inside a zoomed
presentation can be a unit across, and a six-unit gap floated its arrows shapes away
from it. `binding_gap` caps the gap to a quarter of the shape's shorter side; for
anything over 24 units — everything drawn at ordinary zoom — it is exactly Excalidraw's.
The midpoint snap radius (16 px) and the diagonal inset are capped the same way.

**VERIFIED** — the reach for a bind is Excalidraw's `maxBindingDistance_simple`
(`binding.ts@1118751f:133-143`), in world units: `clamp(15 / (min(zoom, 1) · 1.5), 15, 30)`
— 15 at zoom 1 and above, 25 at 0.4, at most 30. One number for the hover outline, the
press that starts an arrow and the drop that ends it (`max_binding_distance`,
`ci_binding_dense.rs::binding_reach_matches_oracle`). It replaced a reach of 32 screen
pixels: at zoom 1 an end 16-32 units beside a shape no longer binds, zoomed in the reach
is larger on screen than it was (450 px at 30×), and zoomed out it is smaller — 30 units
is 3 px at 10% (`MIN_ZOOM`), where it was 32. Both are the oracle's.

## What an end can bind to

**VERIFIED** — `arrow_target_among` transcribes the live oracle's
`getBindingCandidates` + `getHoveredElementForBinding`
(`element/src/collision.ts@1118751f:350-486`; #10753 4850bf33 "binding hit test based on
distance" and dc2c16d9, two days after our pinned SHA — excalidraw.com serves 1118751f):

- targets are rectangles, diamonds, ellipses, images, embeds, frames and free text
  (`isBindableElement`, `typeChecks.ts:184-202`) — not a label, not a line or arrow;
- each is measured by its **signed distance to its painted outline**
  (`signed_outline_distance`: positive inside, negative outside; rounded corners are the
  painter's quadratics, `distanceToElement`) and counts inside it, or outside within the
  reach. A frame's corners are square, as the oracle's frames have no roundness
  (`FRAME_STYLE.roundness: null`, `constants.ts@1118751f:209`) however ours are painted;
  and a frame counts only from outside, so a point inside a slide is aimed at what the
  slide holds; and a shape inside a frame is skipped where the frame clips it from view
  (`isPointClippedByEnclosingFrame`, `collision.ts:283-298`);
- candidates are walked top of the z-order first, and the walk **stops at the first
  opaque one the point is inside** — a shape with a background, or a picture
  (`isOpaqueForBinding`, `:346-348`). A locked shape is never a candidate, but an opaque
  one still hides what is behind it (dc2c16d9);
- the **nearest outline wins**, ties to the one on top (a stable sort). When the point
  is inside the winner, a smaller shape it is also inside — overlapping the winner by
  more than a quarter of its own area and under three quarters of the winner's size —
  takes over, so a nested shape is reached from anywhere inside it. Sizes are each
  shape's own box (`getElementBounds`, `bounds.ts@1118751f:176-209`): a turned diamond's
  corners, a turned ellipse's curve, not the box around the turned box.

So in a Ctrl+D pack of overlapping squares a point just outside one square's edge binds
that square in orbit and a click there finishes the arrow, however many other squares the
point is inside. Before, only a shape containing the point (or one nested in it) could
win, so every click in a pack bound inside the topmost square around it and became a
waypoint: 0 of 816 grid clicks in a 30-square pack finished, 457 do now; 48 of 48 probes
measured on excalidraw.com agree, against 15 before (`ci_binding_dense.rs`).

**IMPLEMENTATION DETAIL, shortcut** — a diamond's distance uses sharp vertices; the
painted ones are rounded (at most w/32 at the tip). The frame-background occlusion of
1118751f (`occludingFrameId`) is not ported: a frame has no background there
(`hasBackground`), so it never applies.

**OBSERVED, mitigated** — a sticky note from the N tool is a group with a filled shadow
rectangle 3 units down and right of the note, underneath. Beside the note's right or
bottom edge the shadow's outline is the nearer one, so from about 1.5 units out to about
18 (the reach past the shadow's edge) the rule binds the **shadow**: inside it, a
waypoint, up to 3 units out, in orbit beyond. The oracle's rule gives the same answer on
that scene; the previous rule bound the note once the point was outside the shadow
(equal sizes, tie to the top). A new note's shadow is therefore **locked**
(`createStickyNote`; `e2e/arrow-dense.spec.ts` › "an arrow aimed beside a sticky note"):
never a candidate, and still an occluder. A group carries its locked members
(`carried_by`, the eraser's `erased_with`) — **OBSERVED** with a new note: moved,
duplicated, deleted and erased, its shadow went with it. **Open:** a note
made before this change, or unlocked from the menu (which unlocks its shadow too), still
offers the shadow. The fix is the planned single-element sticky note, whose migration
must also rebind arrows bound to a shadow onto its note.

Ctrl+D copies ten units down and right, as the oracle does (`DEFAULT_GRID_SIZE / 2`,
`actionDuplicateSelection.tsx:78-79`); it was twelve.

`bindable_among` / `bindable_at` remain for **labels** (a text placed into a container):
rectangles, diamonds and ellipses, smallest area wins, not fill-aware.

## Suggesting a binding

**VERIFIED** — with the arrow tool in hand and nothing being drawn, the shape an arrow
started here would attach to lights up (`App.tsx:7939-7973`). The host forwards moves
with no button held, coalesced per frame, to `hoverPointer`; every tool but the arrow
returns at once. The highlight is the shape's outline plus a dot on the side midpoint
the pointer is near — in the highlight colour where a drop would snap to it, grey
within twice that (`interactiveScene.ts:284-322`) — and nothing inside the shape, where
a drop binds exactly where it is. The dot is in the highlight colour only when the drop
really snaps: never on the grid, and during a drag only when the anchor the drop chose
is that midpoint — not with Shift held, nor on the shape the far end is bound to.

The suggestion goes out when the gesture ends, is cancelled or is taken over by a peer,
when the tool changes, when undo replaces the scene under it, and when the shape is
deleted.

## Moving things

**VERIFIED** — an arrow turned or resized on its own lets go of both ends
(`resizeElements.ts:241-252`, `930-946`). A group turned or scaled carries its arrows
rigidly, and an end bound to a shape outside the group lets go
(`resizeElements.ts:464-475`, `1550-1569`). A line or arrow in a group is transformed
through its points (`group_transform.rs`), so it keeps no angle of its own and a leftward
line no longer jumps a width when the group is flipped. A copy keeps an end's anchor
only when the shape was copied with it.
