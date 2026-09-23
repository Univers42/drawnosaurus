# Binding

Markers: **OBSERVED** (measured in the running editor), **VERIFIED** (read and
measured), **INFERRED**, **IMPLEMENTATION DETAIL**, **UNKNOWN**.

## Target resolution

**VERIFIED** — `bindable_among`/`bindable_at` (`scene/binding.rs`) used to test only a
candidate's axis-aligned bounding box, ignore `angle` entirely, and return the first
match walking z-order topmost-first — full stop, regardless of how much larger that
match was than a candidate underneath it. A small shape nested inside a larger one (a
circle inside a rectangle used as a frame) lost to the rectangle whenever the rectangle
was drawn or brought to front after the circle, since its giant box matched first for
every point inside it. Confirmed with a failing test before the fix
(`ci_line_multipoint.rs::an_arrow_binds_to_a_small_shape_nested_inside_a_larger_one`,
`ci_binding.rs::bindable_at_prefers_the_smaller_nested_shape_even_when_it_is_not_topmost`).

**VERIFIED** — neither `Frame` membership nor `group_ids` play any part in this. `Frame`
is excluded from `is_bindable_element` outright (a frame is never itself a bind target),
and grouping has no effect on `iter_ordered()` or hit-testing at all — it is
post-selection metadata resolved after a click already picked a concrete element
(`edit::group::selected_group_for`). The mechanism is plain z-order plus a bounding-box
match, nothing about frames or groups specifically.

**VERIFIED, fixed** — target resolution now reuses the same real per-shape geometry
selection hit-testing already has: `within_shape` (ellipse/diamond/box equations, not a
box) and `to_element_local` (un-rotates the query point first), both from
`scene::geometry`. Among every candidate that matches, the smallest bounding-box area
wins; z-order is only the tiebreak — unchanged from before for two similarly-sized
overlapping shapes (`bindable_at_topmost`, `bindable_at_zorder_and_exclusion`), and now
correct for one shape nested inside another regardless of which was drawn last.

**IMPLEMENTATION DETAIL, deliberate** — binding is _not_ fill-aware the way selection is.
`hit_test_element` treats a transparent shape as hollow (a click in its open middle falls
through to whatever is drawn inside it); binding does not, and should not — every
existing binding test aims at a shape's interior expecting a bind
(`an_arrow_still_binds`, `bindable_at_topmost`, both using `box_at`'s transparent
default). A shape is a valid binding target anywhere within it, filled or not; only
_which_ shape among several matches is decided by size, not fill.

## Open

**UNKNOWN** — the smallest-area tiebreak is reasoned from this codebase's own tests
(fill-agnostic; z-order only breaks ties), not read from Excalidraw's source —
`third_party/excalidraw` was not fetched when this was written. Run `make oracle` and
check `packages/element/src/binding.ts` (or wherever candidate resolution lives at the
pinned SHA) for how it actually picks among overlapping bindable shapes; correct this
note to VERIFIED, or note the divergence, once checked.

**UNKNOWN** — whether a shape's _true_ area (e.g. an ellipse's `πrxry`) should rank
differently from its bounding-box area for the size comparison. Only the relative order
matters for the cases tested so far (a circle noticeably smaller than its enclosing
rectangle); an ellipse and a diamond of near-identical bounding box but different true
area have not been checked against each other.
