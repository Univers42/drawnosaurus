# Z-order

Bring forward, Send backward, Bring to front and Send to back are a transcription of
Excalidraw's `packages/element/src/zindex.ts@1118751f` (`engine/crates/draw-engine/src/edit/zorder.rs`),
pinned by every z-order case of the oracle's own `zindex.test.tsx` (`ci_zorder.rs`: 70
cases, 161 steps, each citing its line).

## What moves together

**VERIFIED** (the oracle's tests, ported):

- a **group** is one block to step over — its outermost group, or inside an entered group
  the level just inside it (`getTargetIndex`, `zindex.ts:193-299`); inside an entered group
  nothing steps or goes to an end outside it (`:214-254`, `:458-486`);
- a **frame and its children** are one block to step over (`:256-267`); a selected frame
  takes its children (`includeElementsInFrames`, `selection.ts:196-210`); a child moved
  alone goes to the end of its frame's range, not of the board (`:543-621`) — with
  `[C1, C2, F, X]`, Bring to front on C1 gives `[C2, F, C1, X]`;
- a **label** moves with its shape and is stepped over with it (`includeBoundTextElement`,
  `:88-127`). It never moves without its shape: a label whose shape stays (locked, held
  by a peer, or not selected) stays on it (`carried_by`, `edit/group.rs`).

A frame's range is from its lowest member to its highest, whatever lies between, exactly as
the oracle reads it (`getContiguousFrameRangeElements`, `:129-147`).

## Keys

| chord                              | command        |
| ---------------------------------- | -------------- |
| Ctrl/Cmd + ]                       | Bring forward  |
| Ctrl/Cmd + [                       | Send backward  |
| Ctrl + Shift + ], Ctrl/Cmd + ⌥ + ] | Bring to front |
| Ctrl + Shift + [, Ctrl/Cmd + ⌥ + [ | Send to back   |

With Shift or Alt held the physical key decides (`event.code`), as the oracle's
`actionZindex.tsx` matches it (`engine/src/host/keys.ts`). Zoom (Ctrl + = / + / - / 0) is read
from the printed key and checked first, so Ctrl++ still zooms on a layout that puts + on a
bracket key (Dvorak, QWERTZ). The oracle matches zoom by physical key too
(`actionCanvas.tsx:171-173`), which there gives that chord to the z-order.

## Divergences

| what                                | Excalidraw                                                                                                                                                      | here                                                                                                                                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a label's frame and groups          | the bound text carries its container's `frameId` and `groupIds` (`frame.ts:562-583`, `App.tsx:7081`)                                                            | a label carries no `frameId` (its shape holds the membership, `scene/frame.rs`) and an old one may carry no groups: both are read from its shape. The same on an oracle board               |
| a label whose shape is not live     | still finds the deleted shape (`zindex.ts:94-107`)                                                                                                              | read as unlabelled: the engine restacks only the live stack, tombstones stay at the bottom (`Scene::set_order`)                                                                             |
| a locked element in the selection   | never there on its own — Select All skips locked elements (`actionSelectAll.ts:32-38`)                                                                          | this Select All takes them, to unlock from the menu; the command moves the carried set, so a loose locked element stays and a locked group member goes with its group                       |
| a label in the selection            | never there: Select All skips bound text (`actionSelectAll.ts:32-38`), and a click on a label hits its shape, since bound text is not hit (`App.tsx:6726-6736`) | Select All takes labels, and a click on one selects it alone. A label moves only with its shape, so a lone label stays where it is; the oracle would have selected the shape and moved both |
| a peer's hold                       | —                                                                                                                                                               | a frame child or label a peer holds still moves with what carries it: the stack is not stamped, so it takes nothing from their edit                                                         |
| to-the-end chords                   | Shift on Windows and Linux, Alt on macOS (`actionZindex.tsx`)                                                                                                   | both, on every platform                                                                                                                                                                     |
| a command that moves nothing        | the store records no step for unchanged elements                                                                                                                | the same, and no scene is sent to the host                                                                                                                                                  |
| each frame's pass of Bring to front | scans the whole stack, once per frame whose children move (`getIndicesToMove`, `:36-70`)                                                                        | scans that frame's range: the same result, O(n) over the board (`cargo bench --bench editing -- reorder`)                                                                                   |

## What joins a frame

**OBSERVED** on excalidraw.com (2026-09-25) and **VERIFIED** against the source — what joins
a frame goes **directly below it**, above the frame's other children
(`getFrameChildrenInsertionIndex`, `frame.ts@1118751f:521-536`):

- a shape **drawn** in a frame (`insertNewElements`, `App.tsx@1118751f:7754-7782`);
- a shape **dragged** into one, and a shape a new frame is **drawn over** — which then sits
  directly below that frame, on top of the board (`addElementsToFrame`,
  `frame.ts@1118751f:538-635`);
- a copy **pasted** into one (`duplicateAtSceneCoords`, `App.duplicate.ts@1118751f:79-136`).

A label goes with its shape (`:578-582`). A selection dragged in partly from inside the frame
already goes below it as one run, in stacking order (`:601-608` reorders nothing only when
every element was already the frame's). The run is what joined and what the drag carried
(the selected elements in the frame, `App.tsx@1118751f:12046-12059`): an arrow of the
frame's that the drag only re-routed keeps its place. A child moved inside its frame keeps
its place. The scan looks from the top for the frame or one of its children, so with a child
above its frame (a stack the commands leave, see `[C2, F, C1, X]` above) the newcomer goes
above that child.

A frame **resized** puts all its children in one run directly below it, even when nothing
joined — the oracle takes them all out and adds them back on every resize
(`replaceAllElementsInFrame`, `frame.ts@1118751f:684-694`, from
`App.tsx@1118751f:12097-12117`) — so a child left above its frame goes below it. The run is
the children it had, in their order, then what it took in (`getElementsInResizingFrame`,
`frame.ts@1118751f:283-377`). A frame moved restacks nothing unless it took something in.
Pinned by `ci_zorder.rs` › "What joins a frame" and `e2e/zorder.spec.ts`.

| what                         | Excalidraw                                                                                                  | here                                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| newcomers of a resized frame | loose ones first, then whole groups (`getElementsInResizingFrame`, `:342-373`)                              | in stacking order                                                                                          |
| a frame moved over shapes    | takes nothing in: a drag adds the selection to the frame under the pointer (`App.tsx@1118751f:12040-12059`) | takes in what it now contains, as a frame drawn does (membership is judged where things are), and restacks |

**IMPLEMENTATION DETAIL** — the commit judges membership (`judge_frame_membership`,
`engine/pointer_end.rs`) and restacks the run under the frame (`stack_under_frame`) in the
same step, so undo takes both back. The stack moved, and the delta says so with `order`,
every live id (`Scene::take_delta`): the host puts its copy in that order
(`sceneMirror.ts`), and the autosave and the live link send the order they hold
(`sceneDiff.ts`). Where something created in the step goes is part of its creation, not a
reorder undo records: undo tombstones it where it stands and redo brings it back there.

**MEASURED** (`cargo bench --bench editing -- frame_join`, native, press to events) — one
rectangle drawn into a frame on 20,000 elements: 23.6ms when the whole scene went to the
host, 5.06ms with the order (2.2ms outside a frame); 10.7MB of scene to 0.52MB of delta; and
no id lists kept per step of history where there were two (1.9MB a step). A peer applying
that order: 533ms to 10.8ms (`-- remote_patch`). A shape dragged into a frame was there
before, so its step still keeps the two lists, as every z-order command's does.

**VERIFIED**, a quirk kept — a copy keeps its original's `frameId`
(`duplicate.ts@1118751f:597-598` clears it only when the frame is not kept), so a copy of a
frame child pasted back into that frame is already the frame's and is not restacked
(`frame.ts@1118751f:601-608`): it lands on top of the board, above the frame, in both.

## Open

**Ctrl+D** — the oracle puts each copy directly above its original
(`duplicateElements`, `duplicate.ts@1118751f:430-436`), so a copy of a frame child stays in
its frame's run. Here a copy goes on top of the board unless a group is being edited
(`duplicate_selection`, `engine/clipboard.rs`), so a copied child sits above its frame.
The commands above handle that stack as the oracle's do ("DENORMALIZED"), but it is not the
stack Excalidraw would hold.
