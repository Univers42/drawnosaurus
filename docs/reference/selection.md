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
(`App.tsx:9656-9660`, `:12183-12260`); shift-drag extends; shift on empty canvas keeps the
selection. A plain click on empty canvas clears, and so does one in the hole of the
selection's box, where a drag would move it (`App.tsx:12344-12387`, `ci_grab_selected.rs`).
Each rule is another's escape hatch (`ci_multi_select.rs`).

## Moving

**VERIFIED** — grabbing any member of a multi-selection carries the rest, and does not
narrow the selection to it.

**VERIFIED** — a bound arrow moved on its own **releases** each end whose shape is not
moving with it (`dragElements.ts:110-167`). An end whose shape is in the drag stays bound.
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
dotted box around all of them (`interactiveScene.ts:1922-1948`, `:2027-2052`). Canvas
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
drawing tool lets go of the selection without a capture (`App.tsx@1118751f:6110-6256`), so
undoing a new shape gives back what was selected before it. What a peer deleted since is
not selected again (`filterSelectedElements`, `delta.ts@1118751f:875-902`), and a step made
inside a group steps back into it (`editingGroupId`, `delta.ts@1118751f:806-818`).
Pinned by `ci_history_selection.rs`.

| what               | Excalidraw                                                                                                          | here                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| a selection change | its own history entry when nothing else changed: undo walks back through selections (`history.ts@1118751f:117-137`) | never a step: undo and redo move only through edits, each putting back the selection it recorded (`engine/stamp.rs`) |
| a peer's change    | never in local history                                                                                              | the same: a peer's patch is never a step                                                                             |

## Open

**UNKNOWN** — alignment snapping is on by default here (a moved arrow snapped 6px onto a
box edge). Excalidraw's object snapping is a toggle, off by default. Not yet compared.

**UNKNOWN** — whether moved elements should bump `version`. Moves currently do not; a
radius edit does, because history deduplicates on version and geometry and a radius
changes no geometry. Worth checking against the server's merge, which ranks by version.
