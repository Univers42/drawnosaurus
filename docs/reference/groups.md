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

**VERIFIED** — a locked member travels with its group (move, resize, rotate, nudge),
but is never picked up on its own; the oracle drags every selected element and refuses
only when all are locked (`App.tsx:10899-10904`).

**VERIFIED** — frames: a group joins or leaves a frame whole; deleting a frame keeps its
children, out of any frame, and selects them (`actionDeleteSelected.tsx:115-122`);
grouping across a frame's edge takes the group out (`actionGroup.tsx:138-150`). Align,
distribute, flip and lock leave membership alone, as the oracle's do outside a drag
(`frame.ts:845-855`). A child a peer holds stays put when its frame moves.

## Where we diverge, and why

|                   | oracle               | ours                                             |
| ----------------- | -------------------- | ------------------------------------------------ |
| model             | `groupIds: string[]` | `group_ids: Vec<String>`, same order and meaning |
| Ctrl+G on a group | no-op                | **toggles**: ungroups one level                  |
| Ctrl+Shift+G      | ungroup one level    | same                                             |
| shift-marquee out | keeps the group      | leaves it and takes whole top-level groups       |
| frame membership  | pointer + overlap    | containment, the group's box taken whole         |

The Ctrl+G divergence is deliberate and requested. The oracle's no-op leaves the key with
no inverse, so there is no way out of a group with the key you reached for; making it a
toggle costs nothing and makes it self-undoing. Ctrl+Shift+G still matches the oracle, so
nothing is lost.

The oracle keeps the edited group when a shift-marquee reaches outside it
(`App.tsx:11331-11345`), which holds part of that group beside whole groups outside it —
the state Ctrl+G turns into groups that overlap instead of nesting. The frame rule is
this engine's older model (`ci_frame.rs`), applied to a group as a whole.

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

**VERIFIED, not implemented** — when part of the edited group is dragged into or out of
a frame, the oracle takes that part out of the group (`updateGroupIdsAfterEditingGroup`,
`App.tsx:12000-12060`). Here the group's membership is decided as a whole.

**Not done** — align and distribute still skip a locked member (`edit/align.rs`), where
the oracle's have no lock filter (flip carries it: `resize.md` › Flip); z-order is not
frame-aware (`zindex.ts` frame ranges); shift-click toggles on press rather than on
release; a click on empty canvas inside the selection's frame keeps the selection, which
the oracle drops (`App.tsx:12367-12387`) and `e2e/grabSelected.spec.ts` pins.
