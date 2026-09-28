# Selection

Markers: **OBSERVED** (measured in the running editor), **VERIFIED** (read and
measured), **INFERRED**, **IMPLEMENTATION DETAIL**, **UNKNOWN**.

## The marquee

**VERIFIED** — containment, not overlap (`getElementsWithinSelection`). A band that clips
a shape leaves it; one that encloses it takes it.

**OBSERVED**, 2026-09-23 — the rubber band was never _drawn_ during a drag. Mid-gesture
`get_pointer_state` reported `kind: "marquee"` and `region_ink` inside the rectangle read 0. The `Marquee` arm of `advance_interaction` updated the rectangle and never called
`request_draw`; the band is chrome, so nothing else dirtied the frame. After the fix the
same patch reads 1. `ci_repaint.rs` now checks every gesture asks for a frame on move —
that is a class of bug, and state-reading tests cannot see it.

## Shift

**VERIFIED** — shift-click adds; shift-click on a held element removes it on the
release, so a shift-drag from a held element moves everything held
(`App.tsx@1118751f:9664-9668`, `:12191-12268`); shift-drag extends; shift on empty canvas keeps the
selection. A plain click on empty canvas clears, and so does one in the hole of the
selection's box, where a drag would move it (`App.tsx@1118751f:12352-12395`, `ci_grab_selected.rs`).
Each rule is another's escape hatch (`ci_multi_select.rs`).

## Moving

**VERIFIED** — grabbing any member of a multi-selection carries the rest, and does not
narrow the selection to it.

**VERIFIED** — a bound arrow moved on its own **releases** each end whose shape is not
moving with it (`dragElements.ts@1118751f:110-157`). An end whose shape is in the drag stays bound.
A lone arrow must first travel 10px (`DRAGGING_THRESHOLD`) so the click that selects it
cannot detach it.

**OBSERVED** — before this, a bound arrow could not be moved at all: `apply_bindings` ran
every frame of the move and re-snapped its ends onto its shapes. Dragged 150px, it ended
exactly where it started.

**IMPLEMENTATION DETAIL, divergent** — the oracle unbinds a multi-selection on the first
pixel; ours applies the threshold there too, so a sub-10px wobble never detaches anything.

**OBSERVED** — a press on the _middle_ of a selected two-point arrow hits its midpoint
handle and bends it rather than moving it. The oracle does the same.

## The chrome

**VERIFIED** — each selected element gets its own outline, and a multi-selection gets a
dotted box around all of them (`interactiveScene.ts@1118751f:1864-1890`, `:1969-1994`). Canvas
dash state is sticky, so chrome sets its dash explicitly or inherits the last element's.

## Undo and redo

**OBSERVED** on excalidraw.com (2026-09-25) and **VERIFIED** against the source — undo and
redo put back the selection the step recorded, as the oracle's history carries it in each
entry's app-state delta (`AppStateDelta`, `delta.ts@1118751f:526-1015`): undo the selection
before the step, redo the one after. Click A, Delete, Ctrl+Z → A is back and selected;
Ctrl+Shift+Z → nothing selected. So the properties panel stays up under Ctrl+Z and shows
the value undo put back (`e2e/console.spec.ts`). Here every undo and redo used to let go of
everything.

The selection a step began with is the one the last capture saw, never the press that
started it (`store.ts@1118751f:376-385`, the pointer-up capture `App.tsx@1118751f:12451-12464`):
a shape dragged from unselected comes back unselected. A command's selection with no
gesture after it — Select All, then Delete — is what the next step began with. Picking a
shape tool lets go of the selection without a capture (`App.tsx@1118751f:6110-6256`), so
undoing a new shape gives back what was selected before it. Picking the pencil is a capture
(`App.tsx@1118751f:6204-6206`; "should create entry when selecting freedraw",
`history.test.tsx@1118751f:1249`): click A, pencil, a stroke, Ctrl+Z → the stroke is gone,
the pencil still in hand and nothing selected, so the next colour picked restyles nothing.
Auto-shape, which the oracle lacks, goes with the shape tools. A click with a shape tool
that draws nothing, or Escape on a shape being drawn, leaves nothing to commit, so what is
selected after it settles as any selection does. What a peer deleted since is
not selected again (`filterSelectedElements`, `delta.ts@1118751f:875-902`), and a step made
inside a group steps back into it (`editingGroupId`, `delta.ts@1118751f:806-818`).
Pinned by `ci_history_selection.rs`.

Nor is the element itself put back deleted-or-not by an edit that never named it: undoing
a move on an element a peer deleted since must not resurrect it. The oracle's delta for a
plain edit carries only the properties that changed — never `isDeleted`, unless the step
itself deleted or undeleted the element — so applying it merges just those onto the
_current_ (tombstoned) element and leaves `isDeleted` exactly as it has it
(`ElementsDelta.calculate`/`applyDelta`, `delta.ts@1118751f:1234-1259,1732-1781`).
`replay_step` mirrors the outcome by skipping such an element outright when the step's own
before and after agree it was never deleted (`engine/stamp.rs`). Pinned by
`undo_does_not_resurrect_what_a_peer_deleted_since` (`ci_version_stamps.rs`).

**A residual gap, pinned as it stands and not endorsed.** A label erased while it was
being typed stays named in the selection — a _committed_ one does not
(`ci_text_edit.rs` › `a_peer_taking_the_shape_takes_its_label_out_of_the_selection`, and
that label is then out of the next Delete's reach too). `abandon_gesture` drops the
un-committed label on the floor: the baseline holds no before for an element that never
committed, so it is discarded rather than restored (`engine/peers.rs:141-146`), and that
happens before `set_peers` looks, so by the time it prunes, `is_held` has no container to
reach through — the label is not in the store at all (`engine/peers.rs:159-166`). What the
peer did was erase it, and the rule above (`filterSelectedElements`,
`delta.ts@1118751f:875-902`) takes a selected id out of the selection when its element is
gone or deleted; here nothing else prunes, and the id dangles until the next selection.
Pinned by `ci_text_edit.rs` › `a_peer_taking_the_shape_of_a_label_still_being_typed_erases_it`
— the assertion and its message carry it, so it is in the test rather than in a commit body.

| what               | Excalidraw                                                                                                          | here                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| a selection change | its own history entry when nothing else changed: undo walks back through selections (`history.ts@1118751f:117-137`) | never a step: undo and redo move only through edits, each putting back the selection it recorded (`engine/stamp.rs`) |
| a peer's change    | never in local history                                                                                              | the same: a peer's patch is never a step                                                                             |

## The points of a line or arrow

**VERIFIED** — holding one point of a line or arrow, and taking it away with Backspace or
Delete, is a **click on the point** and the **first branch of the ordinary delete action**.
It is not a key handler on the line editor: `BACKSPACE` appears in exactly three places in
Excalidraw at `1118751f` — `packages/common/src/keys.ts:37` (the constant),
`packages/excalidraw/actions/actionDeleteSelected.tsx:306` (`keyTest`), and `App.tsx:5954`
(⌘/Ctrl+Backspace, clear canvas) — and `linearElementEditor.ts` contains no `Backspace` at
all. `BUNNY.md:768`'s "5.1 Backspace removes the last point while placing a multi-point
line" is a misreading of `design.md`'s indented feature list; building it as written would
have manufactured a divergence. The oracle's three branches, in order, are at
`actionDeleteSelected.tsx@1118751f:229-272`:

1. `selectedPointsIndices == null` → the whole element (`:229-231`).
2. `length >= points.length` → the whole element (`:234-251`).
3. otherwise `deletePoints`, re-mapping the selection to `[first - 1]` or `[0]`
   (`:253-272`).

`None` and an empty list are different here, which is why
`DrawEngine::selected_points` is `Option<Vec<usize>>` and never `Some(vec![])`.

**VERIFIED, and the reason this is written down** — the oracle's _marquee_ over a point
editor, `LinearElementEditor.handleBoxSelection`
(`linearElementEditor.ts@1118751f:248-309`), **cannot run at that SHA**. Its only call
site is `App.tsx:11275`, guarded by `this.state.selectedLinearElement?.isEditing`
(`:11274`); its own first guard (`:255-259`) needs `appState.selectionElement` non-null;
and `selectionElement` is written in exactly one place, `App.tsx:10497`, which
`maybeDragNewGenericElement` reaches from the **sibling** branch at `App.tsx:11282` — the
regular box select, behind the same `!isEditing` test. So whenever it is offered a chance
to run, `selectionElement` is still null and it returns at `:258`. Excalidraw at `1118751f`
has no marquee for points; clicking a point is the whole gesture. Do not "fix" this by
adding one.

**VERIFIED** — `isPointHandle` (`:1424-1431`) is the elbow filter and it _is_ live: for an
elbow arrow only index `0` and `points.length - 1` are handles, because the middle points
are the router's corners. The identical predicate appears a second time in the dead
marquee (`:290-299`).

**IMPLEMENTATION DETAIL** — the five conditions on `handleSelectionOnPointerDown`
(`App.tsx@1118751f:9351-9364`) gate the _transform handles_, not the per-point selection.
Gate four (`isLinearElement && (isMobileDevice || points.length === 2)`) is what sends a
two-point line to the point editor instead of a degenerate box; it does not take per-point
selection away from one. Gate five (`hoverPointIndex !== -1`) has **no counterpart here**:
this engine has no such field, the gate is trivially true, and none was invented — a press
that lands on a point is routed by the point-hit test instead.

**IMPLEMENTATION DETAIL** — `deletePoints` re-normalises with the _same_ helper placement
uses (`multi_linear.rs`'s `reseat_points`, `engine/point_edit.rs`), because removing the
point that was the origin has to move the origin or the element's box stops containing its
own drawing. Its **polygon rule** (`linearElementEditor.ts:1590-1603`) rewrites
`nextPoints[0]` to the new last point when index `0`, the last index, or the uncommitted
point went — a closed line's two ends are one place, and taking either away opens the loop.

**IMPLEMENTATION DETAIL, and a trap** — the oracle has **no** "≥ 2 points or gone" guard.
Deleting one point of a two-point line leaves a one-point line, drawn as a dot. Adding that
rule is the obvious invariant and it is the wrong one; `ci_point_delete.rs` ›
`a_two_point_line_can_be_reduced_to_one` records what the oracle actually does.

**OPEN** — the held points are **not painted differently**. The oracle fills a held point
`rgba(134, 131, 226, 0.9)` instead of `rgba(255, 255, 255, 0.9)`
(`interactiveScene.ts@1118751f:253-289`), and lights a polygon's last point when its first
is held (`:1135-1144`). `wasm/paint.rs`'s `paint_linear_handles` has no test harness, so
this was not changed blind. `DrawEngine::selected_points` is exposed for it.

## Open

**UNKNOWN** — alignment snapping is on by default here (a moved arrow snapped 6px onto a
box edge). Excalidraw's object snapping is a toggle, off by default. Not yet compared.

**UNKNOWN** — whether moved elements should bump `version`. Moves currently do not; a
radius edit does, because history deduplicates on version and geometry and a radius
changes no geometry. Worth checking against the server's merge, which ranks by version.
