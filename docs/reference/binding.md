# Binding

Markers: **OBSERVED** (measured in the running editor), **VERIFIED** (read and
measured), **INFERRED**, **IMPLEMENTATION DETAIL**, **UNKNOWN**. Oracle paths are
relative to `third_party/excalidraw/packages/` at the SHA in `scripts/oracle-sha.txt`.

The engine side lives in `engine/crates/draw-engine/src/scene/binding.rs`; its tests are
`tests/ci_binding_anchor.rs` (the model), `ci_binding_overlap.rs` (never inside out),
`ci_binding.rs`, `ci_arrow_drag.rs` and `ci_line_multipoint.rs`.

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
ends move by a few units, to Excalidraw's gap, the first time it or a shape it is bound
to is part of a commit, and are stamped with that commit. An edit elsewhere on the board
leaves it as stored: bindings are refreshed for what a commit touched, a peer's patch
included (`refresh_bindings_in_place`, as `align.ts:45-48` updates only what moved).
Undo and redo count as touching what they put back, so an arrow bound to a restored
shape follows it, stamped with the step — one a peer drew after the undone edit
included (`ElementsDelta.applyTo`, `delta.ts:2044-2047,2107-2114`).
`set_anchor` is the only writer of the three fields, so a released end never keeps an
anchor.

**VERIFIED, fixed** — the engine used to store only the id and aim every end along the
line between the two shapes' centres, ignoring `angle`. So a turned shape left its
arrows at a world offset, and an arrow let go beside the corner of a shape arrived at
the middle of the side the centre line happened to cross. The anchor lives in the
shape's own frame (`focus_point` turns it with the shape), so both are gone.

## Where an end binds

**VERIFIED** — `anchor_for_drop` transcribes `binding.ts:644-953`:

| Where the end is let go                      | Binding                           |
| -------------------------------------------- | --------------------------------- |
| nowhere near a target                        | unbound                           |
| near the shape the other end is bound to     | both ends `inside`, where put     |
| inside a shape (geometric, fill-independent) | `inside`, exactly there           |
| near one, Alt held                           | `inside`, exactly there           |
| beside one, near a side midpoint (no grid)   | `orbit`, anchored at the midpoint |
| beside one, otherwise                        | `orbit`, projected (below)        |
| Ctrl/Cmd held                                | unbound (`App.tsx:5753-5761`)     |

The projection (`element/src/utils.ts:697-787`) continues the arrow's own line — from
the far anchor for a straight arrow, from the neighbouring point of a bent one —
through the drop until it meets the shape's diagonals (inset 15 from the corners for a
rectangle) or centre lines (anything else); the anchor is that meeting point, or the
drop itself when it misses. So the end arrives along the side it came in on, at the
height it was aimed. With Shift held the far end's orbit anchor is re-projected too, so
the held angle survives (`binding.ts:933-950`). Shift and grid snapping both turn the
midpoint snap off (`binding.ts:876-878`): it would pull the end off the angle or the grid.

A new arrow binds its tail at the press on the same terms
(`App.tsx:10317-10339`). Whether the gesture was a drag or a click is read off the hand —
screen pixels from press to release — never off the arrow, whose bound ends are pulled
onto outlines and can be a few pixels apart, or collapsed, after a long drag. A path placed click by click finishes when a click binds it in
orbit, or beside the shape it started from; a click _inside_ a shape places a waypoint,
so a path can be routed across shapes (`App.tsx:10178-10205`).

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
The midpoint snap radius (16 px) and the diagonal inset are capped the same way. The
reach for a bind is 32 screen pixels (`BINDING_HOVER_PX`), so a two-unit shape at 30× is
as easy to hit as a sixty-unit one at 1× (`ci_binding_anchor.rs::binding_at_the_deepest_zoom`).

## What an end can bind to

**VERIFIED** — `arrow_target_among` follows `getHoveredElementForBinding`
(`element/src/collision.ts:323-385`):

- targets are rectangles, diamonds, ellipses, images, embeds, frames and free text
  (`isBindableElement`, `typeChecks.ts:184-202`) — not a label, not a line or arrow,
  not a locked element;
- a candidate matches inside it or within the reach of its real, rotated outline — but
  a frame only from outside, near its border, so a point inside a slide is aimed at
  what the slide holds; and a shape inside a frame does not match where the frame clips
  it from view (`bindingBorderTest`, `collision.ts:275-322`);
- candidates are walked top of the z-order first, and the walk **stops at the first
  filled one the point is inside**: nothing hidden under a filled shape is bound through
  it;
- among what matched, the smallest `width² + height²` wins, so a shape nested inside
  another is reachable however the two are stacked.

**IMPLEMENTATION DETAIL, deliberate divergence** — equal sizes go to the one on top,
which is what the eye picks; Excalidraw's stable sort then `pop()` happens to leave the
lowest (`collision.ts:376-384`).

**IMPLEMENTATION DETAIL, deliberate divergence** — once the point is inside a shape,
only that shape or one nested within it (its box inside the other's) can win.
Excalidraw's walk stops at a filled shape the point is merely _near_, so a neighbour a
few units off — on top, or smaller — takes a press made inside another shape; with a
reach set in screen pixels that happened at every zoom. A shape nested in the one
pressed is still reached from just outside its border.

This replaces the two open questions this page used to carry: the tiebreak is read from
the oracle (squared diagonal, not area), and fill does matter, but only as occlusion.

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
