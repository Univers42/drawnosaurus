# The oracle's shape

Pinned at `scripts/oracle-sha.txt`, checked out in `third_party/excalidraw` by
`make oracle`. Never edit it; never lint it.

## Layout

| path | what lives there |
|---|---|
| `packages/excalidraw/components/App.tsx` | the gesture state machine — pointer down/move/up, tools, most behaviour |
| `packages/excalidraw/actions/` | named, addressable commands (`actionFinalize`, group actions) |
| `packages/excalidraw/renderer/interactiveScene.ts` | selection chrome, handles, everything transient |
| `packages/excalidraw/renderer/staticScene.ts` | the document |
| `packages/element/src/` | the model: types, geometry, bounds, collision, groups, linear editing |
| `packages/math/src/` | curves, points, arc length |
| `packages/common/src/constants.ts` | the constants worth transcribing |

## Architecture they have and we do not

- **React + an action registry.** Every command is addressable by name, which is what
  makes their command palette possible. We expose methods. This is the load-bearing
  difference — see `prompt/design.md` §28.
- **Two canvases**, static and interactive, so transient chrome does not repaint the
  document. We have one canvas and two passes. The invariant they preserve is "do not
  redraw the document to move a handle"; whether that costs us anything is a measurement,
  not an assumption.
- **`appState` as one big object**, including selection, editing ids and viewport. Ours is
  spread across the engine struct.

## Semantics worth knowing before reading any of it

- `groupIds: string[]` is ordered **innermost → outermost**. The array *is* the nesting.
- Only `type === "arrow"` binds (`isBindingElementType`).
- Marquee selection is **containment**.
- `roundness` is a mode, not a radius — elements carry `{type: 3}` with no value.
- Points are element-local; `x`/`y` is the first point, not the bounding-box corner.

## Reading it well

Search for the **state** a behaviour implicates, not the feature name. Features are spread
across files; state is not. `grep -n "editingGroupId" App.tsx` finds the whole group
interaction in one list.

Source gives rules. The live site gives behaviour. When they disagree, the site is right
and the source is telling you which guard you missed — record the guard in
`docs/reference/`.
