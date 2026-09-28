# Drawing a shape

Markers: **VERIFIED** (read and measured), **OBSERVED**, **INFERRED**, **IMPLEMENTATION
DETAIL**, **UNKNOWN**.

A shape is drafted by a press and a drag: the press fixes where the box starts and every
move re-reads the box from the press and the pointer. The box is a function of the two and
of the modifiers held, and of nothing else — not of how many moves the gesture was cut into,
and not of which way the pointer went.

## The modifiers on a draft

Both are read as of the **last move**, not of the press: the host reports them on the move,
and the release carries no keys of its own (`Interaction::Draft`'s own `shift` field says so
for the same reason).

**VERIFIED** — Shift squares the draft: the reach on each axis becomes the larger of the
two (`getPerfectElementSize`, `packages/element/src/sizeHelpers.ts@1118751f:181-183` —
`height = absWidth * sign(height)`, so the width decides and the height follows). A note and
an image are the other way round, square unless Shift frees them
(`App.tsx@1118751f:13421-13424`), so a note's flag is inverted before the box is computed.

**VERIFIED** — Alt grows the draft about the press instead of out of it
(`shouldResizeFromCenter`, `keys.ts@1118751f:145-146`; `dragNewElement` is handed
`event.altKey` at `App.tsx@1118751f:13425` and applies it at
`packages/element/src/dragElements.ts@1118751f:371-376`):

```text
if (shouldResizeFromCenter) {
  width += width;
  height += height;
  newX = originX - width / 2;
  newY = originY - height / 2;
}
```

The press is the box's **middle** and each reach is doubled: a drag reaching `w` by `h` from
`(sx, sy)` gives a box of `2w` by `2h` centred on `(sx, sy)`. Two consequences, both pinned:

- **The order is the aspect lock first, then the centre** (`:325-350` runs before
  `:368-376`). Squaring a centred reach would give a box twice the side, so Shift+Alt of a
  100 by 60 reach is a 200 square, not a 400 one
  (`ci_alt_centre.rs` › `shift_and_alt_lock_the_side_to_the_longer_reach`).
- **The centre reads the reach, never the direction.** The oracle's `width` and `height`
  arrive as `distance()` — `Math.abs` (`App.tsx@1118751f:13417-13418`) — and the centred
  corner is computed from those alone. So the four directions off a press are one box, and a
  drag that crosses back over the press is the mirror of one that did not
  (`ci_alt_centre.rs` › `alt_ignores_which_way_the_drag_went`,
  `a_drag_that_crosses_the_press_keeps_it_in_the_middle`).

**A box's size says nothing about where it is, which is why the tests pin the box and not
the dimensions.** A corner-growing implementation that doubles its reach gets 120 by 80 for
a press at (100, 60) and a reach of 60 by 40 — the same numbers Alt gives — and puts it at
(100, 60) instead of (40, 20), with the press as its top-left corner. A width-and-height
assertion passes that. `ci_alt_centre.rs` › `alt_puts_the_press_at_the_centre_not_the_corner`
pins `x` and `y` as well, and the property
`the_press_is_the_centre_of_every_box_alt_draws` checks `element_center` over a thousand
presses and five cameras, so a box is never merely the right size.

**VERIFIED** — the press is a world point, so the camera is not in the answer: the same
press and reach reached through 0.25×, 3× and 7.5× cameras, panned, gives the same box
(`ci_alt_centre.rs` › `alt_centres_on_the_world_press_through_any_camera`).

## What Alt does not reach

**VERIFIED** — an arrow or a line. The oracle never offers `dragNewElement` to one:
`App.tsx@1118751f:13409` gates the call on `!isBindingElement`, and a linear's move goes
down a different branch (`:11209`) that places its points. Alt is not a second thing that
makes an arrow, and the gesture is unchanged by it
(`ci_alt_centre.rs` › `alt_leaves_an_arrow_alone`).

**VERIFIED** — a dragged-out text, and this one is a **known divergence, pinned on purpose**.
The oracle *does* read Alt for a text, but as an anchor ratio rather than a centre:
`anchorRatio: shouldResizeFromCenter ? 0.5 : …` and `x: anchorX - width * 0.5`
(`dragElements.ts@1118751f:358`, `:278`), with `y` left at the origin (`:360`) and the width
floored at one line (`:263-273`). So the oracle's Alt-text grows to both sides of the press
horizontally and not at all vertically. This port leaves the whole text gesture alone rather
than half-porting a different behaviour into it, and pins what it does
(`ci_alt_centre.rs` › `alt_leaves_a_dragged_out_text_alone`) so a parity fix starts from a
red.

**Not ported, and not a gap: the box selection.** Excalidraw reads Alt on a marquee and turns
it into a lasso (`App.tsx@1118751f:11140-11153`, in the pointer-move branch that runs before
`maybeDragNewGenericElement`), and its box-selection call passes
`shouldResizeFromCenter: false` outright (`:13352`). Ours neither lassoes nor centres a
marquee; the marquee is `Interaction::Marquee` and reads no modifier at all. Out of scope
here — panning and paste-suppression own Alt elsewhere — and recorded here so the next reader
does not read the omission as an oversight.

## The zero drag and the small one

**VERIFIED** — a press with no drag leaves nothing behind, Alt held or not, and that is the
oracle's answer rather than a call made here. A new element still of no size at the release
is removed (`App.tsx@1118751f:11900-11903`) and "of no size" is `width === 0 && height === 0`
exactly (`isInvisiblySmallElement`, `sizeHelpers.ts@1118751f:77`). A click is a click.

**Ours is one notch wider, and pinned as it stands.** `end_draft`
(`engine/crates/draw-engine/src/engine/pointer_end.rs`) throws a draft away below **two**
units on either axis, where the oracle's threshold is an exact zero — so a drag of a quarter
of a unit survives there and not here. It is the same threshold with and without Alt, because
it belongs to the release and the centre does not (`ci_alt_centre.rs` ›
`a_drag_too_small_to_keep_is_thrown_away_at_the_release`). Closing it means moving the floor
to an exact zero, which would also let a one-pixel wobble of a click through as a shape.

**A released note moves again — see `sticky.md` › The tool.** The re-anchor on release
(`App.tsx@1118751f:11857-11869`) fires for a centred draft, so the press ends up a note's
east edge rather than its middle. That is the oracle's behaviour, reproduced.

## Where it lives

`interaction/shape_drag.rs` › `rect_from_drag` is the whole computation: the reach, Shift's
lock, and the centre. `engine/pointer_move.rs`'s draft arm passes `self.alt_held` for a
shape and not for a text. `set_alt_held` on the binding is the host's whole job — the host
reports that Alt is held and nothing else (law 3).

`draw_engine.rs` › `shape_drag_rect_from_drag` and `…_from_the_centre` are the unit cases;
`ci_alt_centre.rs` is the behaviour, including the four properties.
