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

## Open

**Not done** — the oracle also keeps a frame's children in one run directly below it
whenever membership changes: a new element drawn in a frame is inserted there
(`insertNewElements`, `App.tsx:7754-7782`), and so is one dragged in or captured by a new
frame (`addElementsToFrame`, `frame.ts:538-632`). Here a shape drawn in a frame lands on top
of the board, above the frame. The commands above handle such a stack exactly as the
oracle's do — its own tests pin that case ("DENORMALIZED") — but the stack itself is not
the one Excalidraw would hold.
