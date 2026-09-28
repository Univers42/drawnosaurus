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
The oracle _does_ read Alt for a text, but as an anchor ratio rather than a centre:
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

## Snapping to objects while drawing and resizing

`design.md:163` asks for "Snap to nearby objects" under the shape tools, and until 6.3 it
was a move-only gate: a drag stuck, a draw in the same place did not. The oracle has **four
exported** entry points into `snapping.ts` and this engine had one. The three that matter
here, and what each contributes:

| entry point                     | call site                 | the moving points                             | the gate                                 |
| ------------------------------- | ------------------------- | --------------------------------------------- | ---------------------------------------- |
| `snapDraggedElements` `:692`    | `App.tsx:11097`           | the moved box's edges and centre              | `isSnappingEnabled`                      |
| `snapNewElement` `:1246`        | `App.tsx:13383`           | **one**: the pointer                          | `isSnappingEnabled` only                 |
| `snapResizingElements` `:1108`  | `App.tsx:13625`, `:13507` | a side handle's two endpoints, a corner's one | plus `length === 1 && angle ≠ 0` refuses |
| `getSnapLinesAtPointer` `:1318` | `App.tsx:7870`            | the pointer, at hover                         | plus `isActiveToolNonLinearSnappable`    |

**The candidates are boxes, not points.** `getReferenceSnapPoints` (`:616-634`) maps every
reference group through `getElementsCorners` (`:198-313`): four corners and a centre. There
is no outline point and no edge midpoint in that set. Ours is the same three stops per axis
(`interaction/snapping.rs` › `stops_of`), so it carries the four edge midpoints as well — a
superset, and the reason `ci_snapping.rs`'s move cases are stated in terms of edges and
centres rather than of corner points. `ci_draw_object_snap.rs` ›
`a_box_snaps_by_its_centre_as_well_as_by_its_edges` is the case that shows which set it is:
the pointer is 3 from the centre stop and 47 from the nearest edge.

**The reach is `SNAP_DISTANCE / zoom`** in screen pixels (`:48-50`), 6 world units at 1×
here. The oracle's constant is **8**; ours is 6 — `engine/mod.rs` › `SNAP_PX`, which
predates this task. Not changed here, because it is the move path's answer too and that is
pinned. **It is a divergence and it is one number in one place.**

**The press snaps only for the tools the oracle lists** — `isActiveToolNonLinearSnappable`
(`:1402-1414`): rectangle, ellipse, diamond, frame, magicframe, image, text, and **not** a
line, not the selection, not a sticky note. Worth being precise about what that gate _is_:
it gates the **hover**, whose `originSnapOffset` the press then adds to the grid origin
(`App.tsx@1118751f:13388-13394`, `dragElements.ts@1118751f:390-391`). It does **not** gate
`snapNewElement`, which has no tool gate at all — so a sticky note's press does not snap
while the corner you drag out of it does. `engine/pointer.rs` › `snaps_press_origin` is that
tool list and `snap_press` is the offset. **The figure tool is ours and has no oracle at
all** (`rg '"figure"'` over Excalidraw @1118751f finds nothing), so it is given the shape's
answer because it drafts as one; `AutoShape` drafts as a stroke and takes the stroke's.

**The hover preview is the part left out.** The oracle computes `originSnapOffset` on hover
so the alignment is visible _before_ the press; the **rule** it applies is the press, and
that is where it is applied here. Where the shape settles is the same; what is missing is
that it settles without warning first. `hover_pointer` is an arrow-binding path gated on the
arrow tool (`engine/hover.rs:102`), so the preview is separate work, not an extension of
this.

**Two divergences, both deliberate, each in one place:**

- a **turned reference** offers its _unrotated_ box, because `element_bounds` reads
  `x, y, width, height`. The oracle rotates the corners by `element.angle` (`:241-291`).
  Ours does not, for all three paths equally, and
  `ci_draw_object_snap.rs` › `a_turned_reference_still_offers_its_box` pins the unrotated
  answer on the one axis where the two cannot be told apart — the test says so in its own
  comment rather than implying more than it shows.
- the **grid wins** over objects (`engine/mod.rs` › `objects_snap_gesture`). The oracle
  composes the two — `getGridPoint` first, then the snap offset (`:13402-13403`) — and
  consults the grid only in the inverted branch of `isSnappingEnabled` (`:178-184`). Ours
  refuses both branches, which is the move path's rule from before this task, now shared by
  all three so they cannot disagree.

## Equal spacing, and the one rule that decides it

`design.md:821` asks for "Equal spacing". The oracle calls it **gap snapping** and it is a
**move-only** feature — a fact about the call graph, not an inference: `getGapSnaps` is
called from exactly two places, `snapping.ts@1118751f:738` and `:783`, and both are inside
`snapDraggedElements`. `snapNewElement` (`:1246`) and `snapResizingElements` (`:1108`) never
reach it, so a box being drawn and an edge being dragged are never offered a gap.

**The candidates are its own.** This is the first thing to settle and it is the opposite of
what the rest of this page says. `getVisibleGaps` (`:328-444`) re-runs the _same_ gatherer —
`getReferenceElements` → `getMaximumGroups` → the bound-to-container filter, `:341-351` — but
maps each group to its **rounded common bounds** and then forms a candidate per **pair** of
boxes that are separated on one axis and overlapping on the other (`:359-438`). A gap is a
derived offset, not a point, so it cannot be fed to `nearest_axis`: this is the second
candidate maths in the engine and the reason for it is in the type. One gatherer
(`snap_targets`), one gate (`objects_snap_gesture`), one winner discipline (`Nearest`).

**The three candidates per gap**, in the oracle's own order per axis:

| candidate | the offset it wants             | refused when             |
| --------- | ------------------------------- | ------------------------ |
| centre    | `start.max + L/2 − our centre`  | `L ≤ our width` (`:483`) |
| ahead     | `L − (our near edge − end.max)` | never                    |
| behind    | `start.min − our far edge − L`  | never                    |

The centre's guard is the only one, and when it does not fire the control **falls through**
to the two sides rather than skipping the gap — a narrow gap has two landings, not none.
x tries centre, ahead, behind (`:485`, `:502`, `:523`); y tries centre, **behind, ahead**
(`:554`, `:571`, `:592`). The order is unobservable: `both_ends_of_one_gap_are_never_in_
reach_together` sweeps 81,920 boards and never finds both ends of one gap in reach at once,
because the point pass runs first and shrinks the reach to the nearest stop.

**The tie-break is the whole task, and it is two rules, not one.**

1. _Within reach_ keeps, _strictly nearer_ discards (`nearest_axis` and `gap_axis` both go
   through `Nearest::offer`, `snapping.ts:660-672` and `:485-489` are the same three lines).
   So a **tie keeps both** and the incumbent — the one found first — wins the offset, because
   the oracle lands on `nearestSnapsX[0]` (`:752`).
2. The discard is **shared across the two passes**, which is what `Nearest::epoch` is for.
   `nearestSnapsX.length = 0` empties one list that the point pass and the gap pass have both
   been pushing into, so a gap nearer than a point snap takes its place rather than joining
   it. A per-pass list gets this wrong with no single-pass test able to see it, and the first
   version of this did.

`ci_equal_spacing.rs` › `tie_board` is the board that discriminates: three boxes where a point
candidate and a gap candidate both want `±2`, so the landing is **74** and the two plausible
wrong rules both give **70**. The same drag on two of the three boxes lands at 70 and agrees
with both — which is exactly why it looks right on a quiet board.

**One divergence, deliberate and in one place.** The oracle's `createPointSnapLines`
(`:828-896`) groups by coordinate and draws **every** tied _point_ snap, so a row of three
aligned boxes gets one guide spanning all three. Ours draws one point guide per axis
(`point_guides`). A gap snap does draw both of its segments. Changing the point half is a
change to the alignment-guides feature (`design.md:823`, already `covered`) and it would move
a 6.3-green assertion — `ci_snapping.rs:144` expects two guides for a board whose x axis is
itself a two-way tie.

**Cost, stated rather than hidden.** `visible_gaps` is O(n²) in the _visible_ elements, on
every frame of a drag, where the oracle computes it once per gesture (`SnapCache`, `:463`,
filled at `App.tsx@1118751f:10576-10579`). The oracle's own cap is carried over at the same
number (`VISIBLE_GAPS_LIMIT_PER_AXIS`, `:45` — 99,999, annotated there as a TODO to remove),
which bounds it but does not make it cheap. The upgrade path is to gather the gaps in
`begin_move` beside `static_bounds`; it is not done here because it changes
`Interaction::Move` and every test that constructs one, and this task's subject is the rule.

**`design.md:832` "Configurable increments" is `deferred: not in the oracle`.** It is a child
of **"Angle snapping"** in the `design.md` tree (`:825`), not of object snapping, and the
oracle has no setting for it: `SHIFT_LOCKING_ANGLE` is a module constant
(`packages/common/src/constants.ts@1118751f:31`, `Math.PI / 12`), and `appState` carries no
angle-increment field — the only snap-adjacent settings in it are `gridSize` and `gridStep`
(`types.ts:1118751f:505-506`, which is `design.md:802`'s "Configurable grid"). The 15° lock
itself is ours since 6.2. **No settings UI was invented.**

**`design.md:839` "Connection points" is `deferred: not in the oracle`, under another name
and already built.** The term does not occur in the oracle at all — `rg -i "connection
point"` over `packages/` finds nothing. The real thing is `getAllMidpoints`
(`packages/element/src/utils.ts@1118751f:743-767`): **four sites per bindable shape**,
rotated by `angle` — a diamond's four **edge midpoints** (the quarter points, from
`bezierEquation(curve, 0.5)` on the base-corner curves, spelled out literally at `:686-692`),
and for everything else the four **axis midpoints** `(w, h/2), (w/2, h), (0, h/2), (w/2, 0)`.
The shapes are `isBindableElement` (`typeChecks.ts@1118751f:184-202`): rectangle, stickynote,
diamond, ellipse, image, iframe, embeddable, frame, magicframe and unbound text — **`line` is
not among them**, nor `freedraw`, nor a selection. It is reached by both binding paths
(`getElbowArrowSnapMidPoint`, `utils.ts:769-786`, and `getSnappedMidpointIndexForSimpleArrow`,
`:717-741`), and gated on the `isMidpointSnappingEnabled` preference
(`types.ts@1118751f:368`). Ours is `scene/binding.rs` › `side_midpoints`, and it has the same
four sites and the same rotation. **One divergence: for a diamond it uses the four vertices
where the oracle uses the four edge midpoints** — a real gap, a 25% inset on a 100×100
diamond, and the file's own doc comment asserts the wrong answer rather than admitting a
choice. Not fixed here: it is the _binding_ feature, not this one, and it is reported as a
Phase 1 task.

`design.md:288` is unaffected and stays `deferred: not in the oracle`: a line's endpoint
still snaps to the grid and then to the angle lock, and to nothing else. Nothing above puts
a line in the object-snap set — `isActiveToolNonLinearSnappable` excludes it,
`handlePointDragging`'s closure never calls into `snapping.ts`, and `snapNewElement` is not
on that path at all. The next section says so at length.

## Where a line's own endpoints land

`design.md:288` asks for "Endpoint snapping" and reads as though an endpoint is pulled
toward other elements. It is not, and the reason is worth writing down because four
places in the oracle look like they do it.

Placing a line point by point drags the _preview_ point (`App.tsx@1118751f:11253`);
dragging an existing line's endpoint drags a _committed_ one (`App.tsx@1118751f:10853`).
Both are `LinearElementEditor.handlePointDragging`, and its transitive closure —
`createPointAt`, `_getShiftLockedDelta`, `pointDraggingUpdates`, `movePoints`,
`_updatePoints` — contains no call into `snapping.ts` at all. The candidate list is two
entries, in this order:

1. **the grid**, per axis, via `getGridPoint` (`linearElementEditor.ts@1118751f:1468`,
   `points.ts@1118751f:69-81`). Not a distance: a threshold of `size / 2` on each axis,
   so a pointer at the corner of a cell moves `size / 2 * √2` — the bound
   `ci_end_snap.rs` uses, and the one a `size / 2` bound would fail.
2. **the angle lock** (`linearElementEditor.ts@1118751f:1895-1935`), Shift and a single
   point dragged. It replaces the free branch rather than composing with it, but it
   grid-snaps the pointer first (`:1916`), so grid then angle.

**The angle lock carries two open divergences, and neither belongs to the rotation path.**
`SHIFT_LOCKING_ANGLE` is `Math.PI / 12` — **15°** (`constants.ts@1118751f:31`) — used by
`getLockedLinearCursorAlignSize` (`sizeHelpers.ts@1118751f:196-197`) and by the creation
path's `getPerfectElementSize` (`:171-172`). `constrain_to_angle`
(`interaction/linear_drag.rs:17`) steps by `PI / 4`, and it has four call sites here: a
dragged endpoint (`pointer_move.rs:399`), a preview point (`multi_linear.rs:279`), a
drag-drawn line (`linear_drag.rs:32`) and an elbow end (`elbow.rs:87`).
`selection/transform.rs` calls none of them; its open rule is a different defect, that
`rotate_element` takes only the pointer position so a rotation is not quantised at all.

Second, the length is kept by different geometry. This engine rotates the delta onto the
locked angle; the oracle intersects the locked ray with the line through the cursor
perpendicular to it (`sizeHelpers.ts@1118751f:236-250`) and zeroes one component outright
for the horizontal and vertical cases (`:229-234`). They agree only when the angle is
already locked. `ci_end_snap.rs` asserts the oracle's floor — a multiple of **15°** — so it
stays true if the step is corrected, rather than pinning this engine's 45° as if it were
the reference.

What is _not_ in the list, each with the line that keeps it out:

- another element's points, midpoints or edges — `maybeCacheReferenceSnapPoints`, the only
  writer of the snap cache, is called from four places (`App.tsx@1118751f:11095`, `13381`,
  `13505`, `13623`) and none is on this path;
- `snapResizingElements` — only from `maybeHandleResize`, which runs under
  `resize.isResizing` (`:10725`), and a press on a linear point never sets it (`:9405-9407`);
- `snapDraggedElements` — the endpoint path returns at `:10886`, before the branch that
  reaches it;
- `getSnapLinesAtPointer` — gated on `isActiveToolNonLinearSnappable`
  (`snapping.ts@1118751f:1402-1414`), which lists rectangle, ellipse, diamond, frame,
  magicframe, image and text, and **not** `line`;
- the same line's other points, and arrow binding — `pointDraggingUpdates` returns the
  naive drag for anything that is not an arrow (`linearElementEditor.ts@1118751f:2410-2415`).

So the first point of a placed line is `getGridPoint(origin.x, origin.y, ctrl ? null : grid)`
(`App.tsx@1118751f:10235-10239`) and nothing else, and `registry.ts`'s note on that rule
is right about the crate and wrong about the reason: it is not that nothing here computes
it, it is that the oracle has none.

**Ctrl is part of the answer.** All **sixteen** of the oracle's pointer call sites pass a
`null` grid under Ctrl/Cmd, because Ctrl inverts snapping and the grid is what it switches
off. Fifteen of them, that is: the sixteenth is `App.tsx@1118751f:9899-9902`, which passes a
bare `null` **regardless of Ctrl** — the freedraw press, which the next section is about.
`snap_gesture` is the gate for the other fifteen; `snap` is the unconditional one, which
paste keeps because duplicating and pasting grid-snap with no modifier test at all
(`App.duplicate.ts@1118751f:97-101`).

## A freedraw stroke is outside the grid entirely

`App.tsx@1118751f:9899-9902` is the only one of the sixteen `getGridPoint` call sites that
passes a bare `null`, and it is not a typo. A `null` grid returns the point unchanged
(`packages/common/src/points.ts@1118751f:74-80`), and the reason is written a page above the
function: `// TODO: Rounding this point causes some shake when free drawing` (`:68`).

**It is one rule, not a press rule and a move rule.** The move half is the proof, and it is
easy to miss because it is not a `getGridPoint` call at all: the freedraw branch of
`onPointerMoveFromPointerDownHandler` appends `pointerCoords - newElement.x`
(`App.tsx@1118751f:11179-11196`), where `pointerCoords` is the **raw** scene coordinate and
`newElement.x` is the **unrounded** press origin. A stroke's local points are the difference
between the raw pointer and the raw press, so the origin is unrounded _because_ the points
are measured from it. Rounding only the press would shift every point by up to half a cell,
and rounding only the move would do the same in the other direction. Either half alone is
the shake, which is why the question "does the press inherit the move or the other way
round" has no answer to give: there is one rule, and freedraw is outside the grid.

This engine rounded **both** halves — `pointer.rs` snapped the press before `begin_freedraw`
saw it, and `pointer_move.rs` snapped the pointer before the freedraw arm did — so it
diverged in both at once. `ci_freedraw_origin.rs` pins each half separately, with the
arithmetic written out: one move from (503, 300) to (563, 340) on a 20-grid ends at local
(30, 20), where a rounded press gives (31.5, 20) and a rounded pointer gives (28.5, 20). A
rectangle at the same press is still born on 500, and on a 20-grid x = −10 belongs on 0 — a
stroke keeps −10.

**What is not a rule here:** freedraw is the only tool that skips `getGridPoint` entirely,
so `snap_gesture` — and with it Ctrl/Cmd — has nothing to say about it. Holding Ctrl during
a stroke changes nothing, which is the cheapest way to show the press was never _routed
through_ the grid gate and then opted out of.

**The tie is a whole cell.** `getGridPoint` is `Math.round(v / size) * size`, and
`Math.round` breaks a half towards +∞ — `Math.round(-0.5)` is `-0`. `f64::round` breaks it
away from zero. On a 20-unit grid that is every negative half-cell: a point at x = -10
belongs on 0.

## Dragging a label along its arrow

An arrow's label can be moved along the arrow, and the number that records it is a
**fraction of the arrow's own path length**. Both halves of that sentence are load-bearing.

The gesture is a plain primary press on the label and a drag, and it needs the line
editor's own selection. The oracle's chain is `App.tsx@1118751f:8445` (hover, `GRAB`) →
`:9406-9442` (the box handles are taken first) → `linearElementEditor.ts@1118751f:1150-1183`
(the label is grabbed only when `!clickedPointIsHandle && !segmentMidpoint &&
boundTextElement && isArrowElement`, the grab measured from the label's **centre**) →
`App.tsx@1118751f:10766` (the move, past `DRAGGING_THRESHOLD / zoom`) →
`linearElementEditor.ts@1118751f:1963-2030` (`handleBoundTextDragging`, which writes
`labelPosition` and the label's `x`/`y` on every move).

Two things follow that are easy to get wrong. A **line's** label does not move —
`isArrowElement` is inside the guard. And the handles keep precedence: the point handles
and the segment-midpoint knob are tested first, "so a labeled arrow can still be bent at
its middle" (`App.tsx@1118751f:1149-1151`). At the default the label sits under the
midpoint knob, so a press dead on its centre is a point drag — grab it from the side.

The unit is a fraction and not an offset, an index into slots, or a fraction of the box:

```ts
const labelPosition = clamp(
  (prefixSums[bestSegmentIndex] + lengthWithinSegment) / totalLength,
  0,
  1,
); // :2011
const targetLength = clamp(pathParameter, 0, 1) * totalLength; // :2050
```

A fraction and a world-unit offset are indistinguishable on a straight horizontal line and
disagree on everything else, which is why the test that settles it is built on a right
angle. The path is `getLinearElementPathSegments` (`utils.ts@1118751f:206-233`): the drawn
curve for a rounded arrow, its chords for a sharp one, and — an elbow arrow being the
exception — its unrounded logical polyline whatever `roundness` says, because its corners
are the router's right angles. Pieces are measured by arc length, so `0.5` is half the
ground covered, not half the parameter.

`0` and `1` are legal and reachable, clamped on write (`:2011`), on read (`:2050`) and on
load (`restore.ts@1118751f:573-575`, which drops a non-finite one to `null`). `0` is the
path's first point and `1` its last; there is no dead zone.

**A labelled arrow is not convertible, and dragging cannot change that.** 5.5's guard is
`isEligibleLinearElement` (`ConvertElementTypePopup.tsx@1118751f:666-672`), which refuses
an arrow with `hasBoundTextElement` — on the label's _existence_, not on where it sits.
The two features share the label and nothing else.

Two precisions, and they are not interchangeable. A label _told_ a fraction is placed
exactly: locating it interpolates inside a straight walk, so the hand-computed fixture in
`ci_label_position.rs` is asserted at 1e-9. A fraction that came from a **drag** carries the
resolution of the bisection that projected the pointer, about 1e-6 of the path. Excalidraw
is looser still — its `curvePointAtLength` stops within `totalLength * 0.0001`
(`curve.ts@1118751f:534-541`).

### Where it lives

`text/layout.rs` › `linear_label_center` is the placement, extended rather than duplicated:
the one function every bind, re-layout and text edit already goes through
(`bound_text_position`), so a dragged label follows the arrow when the arrow is bent and
there is no second answer to keep in step. `selection/linear.rs` › `path_cubics`,
`path_metrics`, `path_point_at_fraction` and `path_fraction_at_point` are the path's
arc-length model; `math.rs` › `bezier_length`, `bezier_length_to`, `arc_table` and
`cubic_closest_parameter` are the one walk they share, factored out of the
`bezier_point_at_fraction` that 5.1′'s midpoint handles already used. `engine/pointer.rs` ›
`label_grab` is the press, `engine/pointer_move.rs` › `move_label` the move, and it reads
the arrow and never writes it — no points, no extent, no bindings, no `apply_bindings`.
`engine/hover.rs` › `hover_cursor` gives `GRAB` and `Grabbing`. The scene field is
`DrawElement::label_position`, read clamped through `label_fraction`; the contract takes it
as any **finite** number rather than bounding it to `[0, 1]`, because a drag really does
produce `0.2500000018` and a schema that rejected a float overshoot would throw a whole
board away. `ci_label_position.rs` is the behaviour, and `fixtures/label-position.json` is
the hand-computed side of it.

## Where it lives

`render/paint.rs` › `GridSettings::snap_point` is the round; `engine/mod.rs` ›
`snap_gesture` and `snap` are the two entry points, and `engine/pointer.rs` /
`engine/pointer_move.rs` are the pointer paths that pick the gated one.
`interaction/linear_drag.rs` › `constrain_to_angle` is the angle lock, reached from
`pointer_move.rs` › `constrain_point` for a dragged endpoint and from
`engine/multi_linear.rs` › `track_multi_linear` for a preview — the same constraint, two
gestures. `ci_end_snap.rs` is the behaviour, its Q/R pairs and its three properties.

`interaction/shape_drag.rs` › `rect_from_drag` is the whole computation: the reach, Shift's
lock, and the centre. `engine/pointer_move.rs`'s draft arm passes `self.alt_held` for a
shape and not for a text. `set_alt_held` on the binding is the host's whole job — the host
reports that Alt is held and nothing else (law 3).

`draw_engine.rs` › `shape_drag_rect_from_drag` and `…_from_the_centre` are the unit cases;
`ci_alt_centre.rs` is the behaviour, including the four properties.
