# The phone layout

A phone gets its own chrome: a bottom tool bar, a compact style strip, a header that
fits, and touch that draws with one finger and pans and pinches with two. Not a scaled-down
desktop — the desktop's bars are not drawn at all on a phone.

The oracle's numbers are the oracle's (`packages/excalidraw/components/MobileToolbar.tsx
@1118751f`, `packages/excalidraw/components/Actions.tsx@1118751f:731-880`,
`packages/excalidraw/components/App.tsx@1118751f`), and every place this port narrows
one is written down below.

## Which form factor

**VERIFIED** — `formFactor.ts` decides it, and its thresholds are the oracle's
(`packages/common/src/editorInterface.ts@1118751f:81-89`, `:117-133`, `:167-184`):

| the board is… | when                                                             |
| -------------- | ---------------------------------------------------------------- |
| a **phone**   | `width <= 599`, or `height < 500 && width < 1000`                |
| a **tablet**  | its short side is over 599 and its long side at most 1180         |
| a **desktop** | anything wider                                                   |

**DESIGN** — the rule is a *class* on the chrome's root (`.draw-chrome.phone`), not a
media query, because the oracle hangs its phone chrome off one too
(`App.tsx@1118751f:2420-2424`, the `.excalidraw--mobile` class). A class survives the
overlays, the popovers and the dialogs threaded with the same condition, and it cannot
disagree with the bars about the width: every bar reads the one decision. The window's
inner box is the editor's box here — the whole page is the editor — and the class is
re-read on every resize and every rotation, because a rotation is a resize the browser
announces either way.

**DESIGN** — only the phone has its own chrome. The tablet and the desktop keep the
desktop's: a tablet has room for the desktop's bars, and a second layout to keep true is
a second layout to drift.

## The dock

The phone's bottom dock holds two rows, and it is one measured surface
(`data-viewport-ui="bottom"`), so the engine's viewport offsets count the bars where they
are rather than two boxes that could overlap.

**The bottom bar** (`DrawMobileToolbar.svelte`) is the oracle's measured row
(`MobileToolbar.tsx@1118751f:102-154`): seven fixed slots — pan, select, draw, erase, the
two popovers and More — and text, image and frame joining the row as the width allows.

| the oracle's number    | ours                     | what it decides                        |
| ---------------------- | ------------------------ | -------------------------------------- |
| `WIDTH = 36`           | `MOBILE_TOOL_WIDTH`      | a slot's width                         |
| `GAP = 4`              | `MOBILE_TOOL_GAP`        | the gap between slots                  |
| `MIN_TOOLS = 7`        | the base slots           | the row's fixed slots                  |
| `MIN_WIDTH = 276`      | `MOBILE_BAR_MIN_WIDTH`   | the width the row needs for them       |
| `ADDITIONAL_WIDTH = 40`| `MOBILE_BAR_SLOT_WIDTH`  | one more slot's width                  |

Text is promoted from 316px, image from 356, frame from 396 — the oracle's own
thresholds (`MIN_WIDTH + 1/2/3 * ADDITIONAL_WIDTH`, `MobileToolbar.tsx@1118751f:112-114`).
What does not fit is behind **More**, whose trigger wears the active extra tool's own
icon (`MobileToolbar.tsx@1118751f:135-154`): a row of identical squares is a scanning
problem, and a trigger that keeps its face is the difference between reaching for the
right one and reaching for the wrong one.

The two popovers remember the last shape and the last line they were used for and wear
its icon (`MobileToolbar.tsx@1118751f:52-57`, `lastActiveGenericShape` and
`lastActiveLinearElement`) — the same memory, kept in the component that owns the row.

**The style strip** (`DrawMobileActions.svelte`) is the oracle's `MobileShapeActions`
(`Actions.tsx@1118751f:731-880`): the properties the selection has, one button each,
with the rows that travel together coalesced into one popover.

| the oracle's number      | ours                        | what it decides                       |
| ------------------------ | --------------------------- | ------------------------------------- |
| `WIDTH = 32`             | `MOBILE_ACTION_WIDTH`       | a slot's width                        |
| `GAP = 6`                | `MOBILE_ACTION_GAP`         | the gap between slots                 |
| `MIN_ACTIONS = 9`        | `MOBILE_STRIP_MIN_ACTIONS`  | undo and redo included                |
| `MIN_WIDTH = 336`        | `MOBILE_STRIP_MIN_WIDTH`    | the width the row needs               |
| `ADDITIONAL_WIDTH = 38`  | `MOBILE_STRIP_SLOT_WIDTH`   | one more slot's width                 |

Delete is promoted from 374px and duplicate from 412 (`showDeleteOutside`,
`showDuplicateOutside`, `Actions.tsx@1118751f:771-774`); what is not promoted stays in the
layer popover.

**DESIGN** — one deliberate narrowing: the oracle's strip appears with a selection, and
this one is always on the dock. With nothing selected the two colour buttons act on the
*next* shape — the engine's own next style, the way Excalidraw's canvas properties work
— so a thumb can pick a look before it draws one. Everything else on the row is the
selection's and appears with it.

**DESIGN** — the text rows are coalesced into one popover rather than two. The oracle
coalesces rows for the same reason (two 32px buttons for one selection's typing is a row
of near-identical squares), and every text property stays reachable: only the second
button's slot goes.

## The header

The same controls, less of everything else: the title is truncated, the save status is
kept for the screen reader but out of the way (`clip-path`, not `display: none` — the
status is an `aria-live` region and hiding it takes it out of the tree), and the share
button is its icon alone. The row has to fit 360px, and the status and the word "Share"
are what do not.

## The overlays

Every dialog is capped at the screen's height and scrolls inside it
(`.draw-chrome.phone .modal-card`, `draw-chrome.css`): the shortcuts list alone is more
than twice a phone's height, and the Mermaid dialog's two panels are 360px each. The
canvas menu, the main menu and the command palette were already clamped to the screen;
the dialogs were not, and a dialog that grows past the screen is a dialog whose close
button is a scroll away.

## The touch

`touchGesture.ts` owns the geometry; the engine owns the camera — the zoom goes through
`zoomAt` and the pan through `panBy`, so the camera is moved the way a mouse moves it
and the board's own zoom-to-fit and follow-the-presenter keep working.

| gesture                | what happens                                                                 |
| ---------------------- | ---------------------------------------------------------------------------- |
| one finger             | the board's own: draw, select, erase, move                                     |
| two fingers, moving   | the centre's travel pans, twice over (the oracle's multiplier, `App.tsx@1118751f:9160-9212`) |
| two fingers, spreading | the distance ratio zooms at the fingers' centre                                |
| a finger at rest       | after 500ms it opens the canvas menu where it rests (`maybeOpenContextMenuAfterPointerDownOnTouchDevices`, `App.tsx@1118751f:9093-9110`) |

The listeners sit on the **capture** phase of the canvas host, so a touch the gesture
claims is stopped before the engine's own pointer handling sees it: the board draws
nothing under two fingers, and the stroke the first finger began is dropped rather than
committed.

**DESIGN** — the second finger's arrival drops the first finger's stroke, as the oracle
does (`App.tsx@1118751f:8618-8630`), but the *engine* decides what to drop: the front end
surrogate-reports the arrival and the engine's own Escape-equivalent throws the gesture
away. That is wider than the oracle's rule, which keeps a stroke of ten points or more,
and it also clears the selection — the engine's Escape does — so the selection is put
back afterwards. A pinch is not a reason to forget what was selected.

**DESIGN** — the long press's menu is the board's own menu: a synthetic `contextmenu`
event on the canvas, which the engine's pointer input turns into a hit test, a selection
and a menu (`engine/src/host/pointerInput.ts`). A menu of our own would be a second
menu, with its own rows and its own drift from the oracle's.

**VERIFIED** — the long press's lift produces a click, and the menu is under the finger
by then: the click lands on the menu's own backdrop and closes the menu the press had
just opened. The click cannot be prevented at the source (the press was not, and the
engine needs it), so the controller claims it (`consumeClick`) and the caller swallows it
on the window's capture phase.

**VERIFIED** — `zoomAt`'s factor multiplies the scale the engine holds *now*
(`engine/src/cameraMath.ts`, `target.scale / after.scale` at the WASM boundary), so the
ratio is measured against where the last paired move left the fingers, not the gesture's
start: each move is one engine-sized step.

## Where each part lives

| part                | where                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| the form factor     | `apps/web/src/lib/draw-chrome/formFactor.ts` (+ its test)                  |
| the bottom bar      | `apps/web/src/lib/draw-chrome/DrawMobileToolbar.svelte`, plan in `mobileToolbar.ts` |
| the style strip     | `apps/web/src/lib/draw-chrome/DrawMobileActions.svelte`, plan in `mobileActions.ts` |
| the gestures        | `apps/web/src/lib/draw-chrome/touchGesture.ts` (+ its test)                |
| the touch wiring    | `DrawSurface.svelte` — the capture-phase listeners on the canvas host      |
| the phone's CSS     | `apps/web/src/lib/draw-chrome/draw-chrome.css`, under `.draw-chrome.phone` |
| the browser tests   | `e2e/mobile.spec.ts`                                                       |

## The browser tests

`e2e/mobile.spec.ts` is the contract: the chrome stays inside the screen and the bars do
not overlap, a rectangle drawn by touch is never covered by chrome, the style strip
changes a stroke colour, a pinch zooms and a two-finger drag pans and neither draws,
every dialog and menu fits 360px, and the long press opens the canvas menu. The touch
goes through CDP's own input pipeline, so the page sees the same PointerEvents a real
finger produces — a failure means the layout or the input handling changed, never the
viewport or the data.
