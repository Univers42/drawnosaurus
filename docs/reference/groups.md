# Groups

Confidence markers: **OBSERVED** (seen in the running reference), **VERIFIED** (read in
the pinned source _and_ observed), **INFERRED**, **IMPLEMENTATION DETAIL**, **UNKNOWN**.

Oracle pinned at `scripts/oracle-sha.txt`. Live observations taken on excalidraw.com,
2026-09-23, by dispatching pointer and keyboard events and reading `localStorage`.

## The model

**VERIFIED** — `groupIds: readonly GroupId[]` (`packages/element/src/types.ts:73`). An
ordered array, **innermost → outermost**. The array _is_ the nesting; there is no separate
group entity, no tree, and no parent pointer. A group is just an id that several elements
happen to carry.

Observed directly. Three rectangles; group A+B, then group all three:

```
after grouping A+B      A [g1]        B [g1]        C []
after grouping all      A [g1, g2]    B [g1, g2]    C [g2]
```

The outer id is **appended**, and the inner one survives. An element joining only the
outer group carries only the outer id.

**VERIFIED** — `addToGroup` (`groups.ts:311-326`) inserts the new id _before_
`editingGroupId` when one is set, and pushes to the end otherwise. So grouping while
inside a group nests inward; grouping at the top level wraps outward.

## The selection rule

**VERIFIED** — `selectGroupsFromGivenElements` (`groups.ts:243-270`). This is the whole of
nested-group selection, and every other group behaviour falls out of it:

```
groupIds = element.groupIds                       // innermost → outermost
if (editingGroupId) {
  i = groupIds.indexOf(editingGroupId)
  if (i > -1) groupIds = groupIds.slice(0, i)     // only what is strictly INSIDE it
}
select( groupIds.length ? groupIds[last] : element )   // outermost of what remains
```

- No editing group → a click selects the **outermost** group.
- Editing group `G` → a click selects the outermost group still **inside** `G`, or the
  element itself when nothing is left.

## Descending and leaving

**VERIFIED** — double-click (`App.tsx:7310-7334`): when a group is selected and the hit
element belongs to it, `editingGroupId` becomes that group and the hit element is
selected. The selection rule above then picks the next level in. Each double-click
descends exactly one level, to any depth.

**VERIFIED** — leaving (`App.tsx:9641-9650`): a press on an element _not_ in the edited
group clears `editingGroupId` and the selection.

**VERIFIED** — Escape steps out **one** level, into the group directly around, holding
it; only from the outermost does it let go (`actionDeselect.ts:36-62`, `:72-111`).

**VERIFIED** — the edited group is a claim about the selection: it holds only while
something is held, all of it is inside, and the group still has two live members. The
oracle drops it on an empty selection (`App.tsx:12889-12902`), a press outside it,
select-all (`actionSelectAll.ts:49`) and once the group is gone (`delta.ts:806-818`).
Here `set_selection` enforces it (`edit::keeps_editing`), and so do a peer's patch, a
loaded scene and the eraser (`revalidate_editing`), rather than each way out. A lasso
press is the one empty selection that keeps it, as the oracle's does
(`lasso/index.ts:72-89`): the loop is resolved at that level on release.

**VERIFIED** — a click (press and release with no move) on a member of a
multi-selection narrows to that member's group at the current level; any move makes it
a drag and keeps everything (`drag.hasOccurred`, `App.tsx:10918-10921`, `:12183-12190`).

**VERIFIED** — a shift-press on something already held changes nothing until the
release: a click then takes it out, a drag moves everything held, it included
(`App.tsx:9656-9660`, `:12183-12260`). A shift-press on something not held adds it at
once, so it can be dragged in the same gesture.

**VERIFIED** — a press inside the selection's box picks the selection up, hit or hole:
a selected element is hit anywhere in its box and several in their common box
(`App.tsx:6782-6806`, `:9783-9806`), and the cursor says so. A drag from there moves it;
a release with no drag was a click on nothing and lets go of it and of the edited group
(`App.tsx:12344-12387`). A line or arrow edited by its points has no box, and so none to
press in (`hasBoundingBox`, `transformHandles.ts:328-353`).

**VERIFIED** — deleting inside the edited group keeps it open holding its first member,
steps up a level once it is down to one, or leaves it holding the survivor
(`actionDeleteSelected.tsx:130-204`). **IMPLEMENTATION DETAIL, deliberate divergence:**
only a member that is neither locked nor held by a peer is picked; the oracle takes the
first sibling whatever it is, which here would hand a locked element to the next Delete.

## Grouping and ungrouping

**OBSERVED** — **Ctrl+G on a selection that is already exactly one group does nothing.**
Pressed on a fully-grouped selection, the scene came back byte-identical: no new id, no
re-wrap. Excalidraw treats grouping an existing group as a no-op rather than as another
layer.

**VERIFIED** — Ctrl+Shift+G removes **only the selected level**
(`removeFromSelectedGroups`, `groups.ts:327-330`). Observed:
`A [g1, g2] → [g1]`, `C [g2] → []`. Inner groups survive an outer ungroup.

## Structure the operations keep

**VERIFIED** — a group is one run of the stack:

- grouping gathers the members directly under the topmost one, in one undo step
  (`actionGroup.tsx:170-186`);
- z-order steps over a neighbouring group as one block, and inside an entered group
  moves only within it (`zindex.ts:205-311`, `:443-553`);
- a copy made inside the edited group keeps that group and every level around it, with
  fresh ids only for the levels inside (`getNewGroupIdsForDuplication`,
  `groups.ts:397-413`), and goes directly above the group. **IMPLEMENTATION DETAIL:** the
  oracle puts each copy directly above its own source (`duplicate.ts:322-348`); above the
  group is the same run. Any other copy goes on top of the board, as before;
- a label carries its shape's groups — when grouped, and when made
  (`App.tsx:7081`) — sits directly above its shape (`:7103-7108`), and moves and is
  stepped over with it (`zindex.ts:51-54`, `:91-130`). A shape and its own label are
  one thing: they are not grouped with each other, and a group left holding one
  labelled shape is still that group (`actionGroup.tsx:73-83`).

**VERIFIED** — a locked member travels with its group (move, resize, rotate, nudge,
align, distribute, flip), but is never picked up on its own; the oracle drags every
selected element and refuses only when all are locked (`App.tsx:10899-10904`), and its
align, distribute and flip have no lock filter (flip: `resize.md` › Flip).

**VERIFIED** — align and distribute move groups, not elements
(`getSelectedElementsByGroup`, `groups.ts:417-466`): each selected group is one block,
cut one level in when a single group is all that is selected, and at the edited group's
level while one is edited; a label rides with its shape. Distribute spaces the blocks
by equal gaps and, when they overlap too much for any gap, spaces their centres between
the two blocks at the ends, which stay (`distribute.ts:46-100`). Align needs two blocks,
distribute three, and neither is offered while a frame is selected
(`actionAlign.tsx:50-51`, `actionDistribute.tsx:43-44`). The inspector asks the engine
(`canAlign`, `canDistribute`) rather than counting elements, and asks again on every
scene change, since ungroup, lock, undo or a peer's edit changes the blocks under the
same selection: two grouped elements and a third beside them are two blocks, so align
is offered and distribute is not.

**VERIFIED** — frames: a group joins or leaves a frame whole; deleting a frame keeps its
children, out of any frame, and selects them (`actionDeleteSelected.tsx:115-122`);
grouping across a frame's edge takes the group out (`actionGroup.tsx:138-150`). Align,
distribute, flip and lock leave membership alone, as the oracle's do outside a drag
(`frame.ts:845-855`). A child a peer holds stays put when its frame moves.

**VERIFIED** — membership is judged for what a gesture changed, and every member of a
group it changed; a frame moved, resized or drawn judges the whole board. The oracle
judges the selection on release (`updateFrameMembershipOfSelectedElements`,
`App.tsx:12064`). An unrelated click never rewrites membership elsewhere — so a child
aligned out of its frame stays that frame's until it is itself dragged. What a commit
creates — drawn, typed, pasted, duplicated, dropped in — is judged where it lands, as
the oracle gives a new element the frame it is created in (`App.tsx:10442-10465`,
`App.duplicate.ts:124-135`); a pasted or duplicated frame adopts nothing it lands on.

**VERIFIED** — part of the edited group dragged into or out of a frame leaves that
group, and the edited group is let go (`updateGroupIdsAfterEditingGroup`,
`App.tsx:11993-12060`). Each moved member keeps only the groups inside the edited one,
so a group nested in it and dragged whole keeps its own id; a group left with one member
dissolves. A label goes with its shape, and a member a peer holds keeps its groups.

## Where we diverge, and why

|                   | oracle               | ours                                             |
| ----------------- | -------------------- | ------------------------------------------------ |
| model             | `groupIds: string[]` | `group_ids: Vec<String>`, same order and meaning |
| Ctrl+G on a group | no-op                | **toggles**: ungroups one level                  |
| Ctrl+Shift+G      | ungroup one level    | same                                             |
| shift-marquee out | keeps the group      | leaves it and takes whole top-level groups       |
| frame membership  | pointer + overlap    | containment, the group's box taken whole         |
| edited part moved | clears lone groups   | dissolves only the groups the move left alone    |
| into a frame      | board-wide           |                                                  |
| its labels        | stay in the group    | leave with their shapes                          |
| align boxes       | rotated bounds       | unrotated bounds (`scene_bounds`)                |

The Ctrl+G divergence is deliberate and requested. The oracle's no-op leaves the key with
no inverse, so there is no way out of a group with the key you reached for; making it a
toggle costs nothing and makes it self-undoing. Ctrl+Shift+G still matches the oracle, so
nothing is lost.

The oracle keeps the edited group when a shift-marquee reaches outside it
(`App.tsx:11331-11345`), which holds part of that group beside whole groups outside it —
the state Ctrl+G turns into groups that overlap instead of nesting. The frame rule is
this engine's older model (`ci_frame.rs`), applied to a group as a whole; the dragged
part of an edited group is judged by its own box the same way, not by the frame under
the pointer, and a selection that holds every member of its top-level group is a whole
group joining a frame, which keeps its groups.

When part of the edited group leaves, the oracle strips every group id from any element
whose outermost group has fewer than two members anywhere on the board. Here only the
groups that move emptied are dissolved: a lone group elsewhere is someone else's state,
and rewriting it would stamp and send elements the gesture never touched. The oracle
also hands that surgery the selection without its labels (`App.tsx:12001`), so a
label stays in the group its shape left and keeps it alive; here it leaves with its
shape, as every other group operation takes it.

Align measures unrotated boxes, where the oracle measures a rotated element by the box
round what it covers — older than this work, and shared with every other `scene_bounds`
caller.

## Mental model (§4 of `prompts.md`)

- **State** — `group_ids` on each element (the document); `editing_group_id` on the engine
  (the session). The first is serialized, the second is not: which group you have stepped
  into is a property of _your_ view, not of the drawing.
- **Inputs** — click, shift-click, double-click, Escape, Ctrl+G, Ctrl+Shift+G.
- **Transformations** — the five-line rule above, in one function, used by both click
  selection and group expansion so the two cannot drift.
- **Derived** — which ids are "selected groups" is derived from the selected elements
  every time; never stored. **IMPLEMENTATION DETAIL:** Excalidraw _does_ store
  `selectedGroupIds` on `appState` and memoizes the derivation. We derive on demand — the
  invariant it preserves (selection and group membership never disagree) is cheaper to
  keep by not having a second copy.
- **Rendering** — members of the edited group need to look different from a plain
  selection, or there is no way to see which level you are on.
- **Invalidation** — any selection change repaints; there are no dirty regions here.
- **Persistence** — `groupIds` goes in the file; `editingGroupId` does not.
- **Performance** — the rule is O(depth) per element, and depth is tiny. Group expansion
  is a scene scan, which is the same cost as every other selection operation here.

## Open

**Not done** — a shift-press on an unselected element inside the selection's box adds it
at once, where the oracle waits for the release (`App.tsx:9656-9660`). Z-order is
frame-aware now: `zorder.md`.
