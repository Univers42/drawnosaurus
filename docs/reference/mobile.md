# The phone and tablet layouts

A phone gets its own chrome: a bottom tool bar, a compact style strip, a header that
fits, and touch that draws with one finger and pans and pinches with two. Not a scaled-down
desktop — the desktop's bars are not drawn at all on a phone.

A tablet keeps the desktop's chrome, with two differences: its style panel is the
oracle's compact column of buttons and popovers rather than the desktop's panel of rows,
and its top bar holds — the menu, the title, the status chips, the tool bar, Share and
Help never overlap one another at any width from 600 px up.

The oracle's numbers are the oracle's (`packages/excalidraw/components/MobileToolbar.tsx
@1118751f`, `packages/excalidraw/components/Actions.tsx@1118751f:731-880`,
`packages/excalidraw/components/App.tsx@1118751f`), and every place this port narrows
one is written down below.

## Which form factor

**VERIFIED** — `formFactor.ts` decides it, and its thresholds are the oracle's
(`packages/common/src/editorInterface.ts@1118751f:19-26`, `:64-79`, `:137-150`):

| the board is… | when                                                      |
| ------------- | --------------------------------------------------------- |
| a **phone**   | `width <= 599`, or `height < 500 && width < 1000`         |
| a **tablet**  | its short side is over 599 and its long side at most 1180 |
| a **desktop** | anything wider                                            |

**DESIGN** — the rule is a _class_ on the chrome's root (`.draw-chrome.phone`,
`.draw-chrome.tablet`), not a media query, because the oracle hangs its phone chrome off
one too (`App.tsx@1118751f:2420-2424`, the `.excalidraw--mobile` class). A class survives
the overlays, the popovers and the dialogs threaded with the same condition, and it
cannot disagree with the bars about the width: every bar reads the one decision. The
window's inner box is the editor's box here — the whole page is the editor — and the
class is re-read on every resize and every rotation, because a rotation is a resize the
browser announces either way.

**DESIGN** — the phone is the only form factor with a chrome of its own: a bottom dock
instead of the desktop's bars. The tablet keeps the desktop's bars and the desktop's
header, and changes two things — its style panel is the oracle's compact column, and its
top bar holds at every width from 600px up. A tablet has room for the desktop's bars,
and a second set of them to keep true is a second set to drift.

## The dock

The phone's bottom dock holds two rows, and it is one measured surface
(`data-viewport-ui="bottom"`), so the engine's viewport offsets count the bars where they
are rather than two boxes that could overlap.

**The bottom bar** (`DrawMobileToolbar.svelte`) is the oracle's measured row
(`MobileToolbar.tsx@1118751f:102-154`): seven fixed slots — pan, select, draw, erase, the
two popovers and More — and text, image and frame joining the row as the width allows.

| the oracle's number     | ours                    | what it decides                  |
| ----------------------- | ----------------------- | -------------------------------- |
| `WIDTH = 36`            | `MOBILE_TOOL_WIDTH`     | a slot's width                   |
| `GAP = 4`               | `MOBILE_TOOL_GAP`       | the gap between slots            |
| `MIN_TOOLS = 7`         | the base slots          | the row's fixed slots            |
| `MIN_WIDTH = 276`       | `MOBILE_BAR_MIN_WIDTH`  | the width the row needs for them |
| `ADDITIONAL_WIDTH = 40` | `MOBILE_BAR_SLOT_WIDTH` | one more slot's width            |

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

| the oracle's number     | ours                       | what it decides         |
| ----------------------- | -------------------------- | ----------------------- |
| `WIDTH = 32`            | `MOBILE_ACTION_WIDTH`      | a slot's width          |
| `GAP = 6`               | `MOBILE_ACTION_GAP`        | the gap between slots   |
| `MIN_ACTIONS = 9`       | `MOBILE_STRIP_MIN_ACTIONS` | undo and redo included  |
| `MIN_WIDTH = 336`       | `MOBILE_STRIP_MIN_WIDTH`   | the width the row needs |
| `ADDITIONAL_WIDTH = 38` | `MOBILE_STRIP_SLOT_WIDTH`  | one more slot's width   |

Delete is promoted from 374px and duplicate from 412 (`showDeleteOutside`,
`showDuplicateOutside`, `Actions.tsx@1118751f:771-774`); what is not promoted stays in the
layer popover.

**DESIGN** — one deliberate narrowing: the text rows are coalesced into one popover rather
than two. The oracle coalesces rows for the same reason (two 32px buttons for one
selection's typing is a row of near-identical squares), and every text property stays
reachable: only the second button's slot goes.

The strip appears when a shape is selected or a drawing tool is in hand — the oracle's own
rule (`shouldRenderSelectedShapeActions`, the same predicate the desktop's panel uses, and
`shapeActions.visible` here). With neither, there is nothing for it to act on, and the
dock is the tool bar alone. With a drawing tool in hand and nothing selected, the two
colour rows act on the _next_ shape — the engine's own next style, the way Excalidraw's
canvas properties work — so a thumb can pick a look before it draws one.

## The header

The same controls, less of everything else: the title is truncated, the save status is
kept for the screen reader but out of the way (`clip-path`, not `display: none` — the
status is an `aria-live` region and hiding it takes it out of the tree), and the share
button is its icon alone. The row has to fit 360px, and the status and the word "Share"
are what do not.

## The main menu

**VERIFIED** — the top bar is above the bottom bar, so a menu opened from it paints over
the bar rather than under it: the oracle's own rule (`MobileMenu.tsx@1118751f:150-153`),
"welcome screen, bottom bar, and top bar all have the same z-index; ordered in this
reverse order so that top bar is on top". Here the two are siblings with the same
z-index and the header comes first in the document, so the header's z-index is the one
that says which is on top (`DrawHeader.svelte`'s own).

**VERIFIED** — the menu scrolls inside the screen instead of running past it: the
oracle's `DropdownMenu.scss@1118751f:59-68` gives the container `overflow-y: auto` and a
`max-height`. Ours is the same rule, sized by `dvh` and not by `vh`: `100vh` is the page
with the browser's bars hidden, and on a phone the bottom of that page is under them
(`e2e/public/phoneViewport.spec.ts`).

**VERIFIED** — no row of the menu shows a keyboard shortcut: the oracle draws it only
when the form factor is not `"phone"`
(`dropdownMenu/DropdownMenuItemContent.tsx@1118751f:28-29`). There is no keyboard on a
phone, and a chord there is noise where the row's name should be. `mainMenu.ts` holds the
chords and the rule; a tablet and a desktop keep every one of them.

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

| gesture                | what happens                                                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| one finger             | the board's own: draw, select, erase, move                                                                                               |
| two fingers, moving    | the centre's travel pans, twice over (the oracle's multiplier, `App.tsx@1118751f:9160-9212`)                                             |
| two fingers, spreading | the distance ratio zooms at the fingers' centre                                                                                          |
| a finger at rest       | after 500ms it opens the canvas menu where it rests (`maybeOpenContextMenuAfterPointerDownOnTouchDevices`, `App.tsx@1118751f:9093-9110`) |

The listeners sit on the **capture** phase of the canvas host, so a touch the gesture
claims is stopped before the engine's own pointer handling sees it: the board draws
nothing under two fingers, and the stroke the first finger began is dropped rather than
committed.

**DESIGN** — the second finger's arrival drops the first finger's stroke, as the oracle
does (`App.tsx@1118751f:8618-8630`), but the _engine_ decides what to drop: the front end
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

**VERIFIED** — `zoomAt`'s factor multiplies the scale the engine holds _now_
(`engine/src/cameraMath.ts`, `target.scale / after.scale` at the WASM boundary), so the
ratio is measured against where the last paired move left the fingers, not the gesture's
start: each move is one engine-sized step.

## The tablet's style panel

**VERIFIED** — the oracle decides the styles panel's mode from the form factor, not from
the width alone (`packages/common/src/editorInterface.ts@1118751f:152-164`,
`deriveStylesPanelMode`): a phone gets `mobile`, a tablet gets `compact`, and only the
desktop chooses for itself. `formFactor.ts` already answers phone / tablet / desktop by
the oracle's own rule, so the tablet is the band between the phone's 599 and the
desktop's 1180.

**VERIFIED** — the compact panel is `CompactShapeActions`
(`packages/excalidraw/components/Actions.tsx@1118751f:612-724`), which its own comment
calls "the collapsed, popover-driven layout used on tablets": a narrow column of 32px
icon buttons with an 8px gap (`Actions.scss@1118751f:95-179`), each opening a popover.
The rows that travel together are one popover — the oracle's own reason for combining
them (`CombinedShapeProperties`, `CombinedArrowProperties`, `CombinedTextProperties`,
`CombinedExtraActions`).

**DESIGN** — the full inspector is not drawn on a tablet at all. It is 216px wide and as
tall as the screen, over the drawing; the column is 48px wide and as tall as it needs to
be. The oracle's answer for a tablet is the column, and it is the same answer here.

| the oracle's              | here              | what it opens                             |
| ------------------------- | ----------------- | ----------------------------------------- |
| `changeStrokeColor`       | the stroke swatch | the stroke colour picker                  |
| `changeBackgroundColor`   | the fill swatch   | the background colour picker              |
| `CombinedShapeProperties` | one button        | fill, width, stroke style, edges, opacity |
| `CombinedArrowProperties` | one button        | the arrow's type and its heads            |
| `changeFontFamily`        | one button        | the font list                             |
| `CombinedTextProperties`  | one button        | size, alignment, vertical alignment       |
| `duplicateSelection`      | one button        | —                                         |
| `deleteSelectedElements`  | one button        | —                                         |
| `CombinedExtraActions`    | one button        | layers, mirror, grouping, alignment       |

The plan is `tabletActions.ts`, and the rows the popovers open are the phone's own
(`ShapeActionRows.svelte`), so a property cannot behave one way on a phone and another
on a tablet.

**DESIGN** — the column sits under the header, and under the tool bar's own row when the
top bar has one (see below). The oracle puts it under the menu button, beside the tool
bar; here the tool bar's row is above it, so the column is below both.

## The tablet's top bar

**DESIGN** — the call the oracle cannot make for us: its top bar holds the menu, the
shapes and the right-hand cluster, and no title and no status chips
(`LayerUI.tsx@1118751f:239-247`), so it has nothing to give way. Ours has both, and
they give way in this order:

1. **the title first** — it is cut short with an ellipsis, down to `TITLE_MIN` (48px),
   which is enough for a word and the ellipsis;
2. **then the status chips** — they fold into one icon whose label is the whole line
   ("Unsaved changes · Shared copy saved"), so the words are still there for the screen
   reader and for the tooltip, and only the room goes.

The Share button keeps its word: it is at the far end of the row, where the space is,
and a button that is only an icon is a button nobody is sure of.

**DESIGN** — and when the row cannot hold the tool bar and the header's two ends
together, the tool bar takes a row of its own below the header. That is the smallest
change that holds: the title and the chips are given their room back and every tool
stays visible. The alternative — a narrower bar, with tools behind a menu — would hide
tools on a device with room to show them, which is the phone's arrangement and not the
tablet's.

The widths are measured, not guessed: the header measures its own parts (the menu, the
title's natural width, the chips' width), the tool bar measures itself, and `topBar.ts`
turns the two into the plan. The tool bar takes its own row when the space beside it is
less than what the ends need — a menu, a title at its minimum and a folded chip on one
side, the Share button and the Help button on the other. With this chrome's 497px bar
that is below about 800px of viewport, and the chips fold into one icon below about
950px; both move a little with the board's title, which is one of the widths the plan
measures.

| the number     | ours | what it decides                                      |
| -------------- | ---- | ---------------------------------------------------- |
| `TITLE_MIN`    | 48   | the width a cut title keeps                          |
| `TITLE_MAX`    | 180  | the title's own width                                |
| `FOLDED_CHIPS` | 28   | the folded chip: one icon, whatever the statuses say |

The desktop is not touched by any of it: at 1280 the plan gives the title its own width,
leaves the chips open and keeps the tool bar in the header's row, which is the layout the
desktop has always had.

## Where each part lives

| part                 | where                                                                               |
| -------------------- | ----------------------------------------------------------------------------------- |
| the form factor      | `apps/web/src/lib/draw-chrome/formFactor.ts` (+ its test)                           |
| the bottom bar       | `apps/web/src/lib/draw-chrome/DrawMobileToolbar.svelte`, plan in `mobileToolbar.ts` |
| the style strip      | `apps/web/src/lib/draw-chrome/DrawMobileActions.svelte`, plan in `mobileActions.ts` |
| the gestures         | `apps/web/src/lib/draw-chrome/touchGesture.ts` (+ its test)                         |
| the touch wiring     | `DrawSurface.svelte` — the capture-phase listeners on the canvas host               |
| the tablet's panel   | `apps/web/src/lib/draw-chrome/DrawTabletActions.svelte`, plan in `tabletActions.ts` |
| the panel's rows     | `apps/web/src/lib/draw-chrome/ShapeActionRows.svelte`                               |
| the top bar's plan   | `apps/web/src/lib/draw-chrome/topBar.ts` (+ its test)                               |
| the menu's shortcuts | `apps/web/src/lib/draw-chrome/mainMenu.ts` (+ its test)                             |
| the phone's CSS      | `apps/web/src/lib/draw-chrome/draw-chrome.css`, under `.draw-chrome.phone`          |
| the browser tests    | `e2e/mobile.spec.ts`, `e2e/tablet.spec.ts`                                          |

## The browser tests

`e2e/mobile.spec.ts` is the phone's contract: the chrome stays inside the screen and the
bars do not overlap, a rectangle drawn by touch is never covered by chrome, the style
strip changes a stroke colour, a pinch zooms and a two-finger drag pans and neither
draws, every dialog and menu fits 360px, and the long press opens the canvas menu. The
touch goes through CDP's own input pipeline, so the page sees the same PointerEvents a
real finger produces — a failure means the layout or the input handling changed, never
the viewport or the data.

`e2e/tablet.spec.ts` is the tablet's: at 768×1024, 1024×768, 820×1180 and 600×960 the
top bar's parts never overlap one another and never leave the screen, the style panel is
the compact column and covers less than a fifteenth of it, and a stroke colour picked in
the column's popover reaches the shape. At 1280×800 the desktop's own chrome is exactly
as it was: the full inspector, where it was, and the tool bar centred in the header's
row.
