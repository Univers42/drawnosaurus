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

## Grouping and ungrouping

**OBSERVED** — **Ctrl+G on a selection that is already exactly one group does nothing.**
Pressed on a fully-grouped selection, the scene came back byte-identical: no new id, no
re-wrap. Excalidraw treats grouping an existing group as a no-op rather than as another
layer.

**VERIFIED** — Ctrl+Shift+G removes **only the selected level**
(`removeFromSelectedGroups`, `groups.ts:327-330`). Observed:
`A [g1, g2] → [g1]`, `C [g2] → []`. Inner groups survive an outer ungroup.

## Where we diverge, and why

|                   | oracle               | ours                                             |
| ----------------- | -------------------- | ------------------------------------------------ |
| model             | `groupIds: string[]` | `group_ids: Vec<String>`, same order and meaning |
| Ctrl+G on a group | no-op                | **toggles**: ungroups one level                  |
| Ctrl+Shift+G      | ungroup one level    | same                                             |

The Ctrl+G divergence is deliberate and requested. The oracle's no-op leaves the key with
no inverse, so there is no way out of a group with the key you reached for; making it a
toggle costs nothing and makes it self-undoing. Ctrl+Shift+G still matches the oracle, so
nothing is lost.

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

**UNKNOWN** — what the reference does when an element is dragged _out_ of an edited group,
and whether an empty group id is garbage-collected from other members. Not investigated.

**UNKNOWN** — whether `Escape` exits one level or all of them. The source has
`editingGroupId: null` on several Escape paths, which suggests all; not observed.
