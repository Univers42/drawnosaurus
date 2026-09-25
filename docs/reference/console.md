# The properties panel

Confidence markers: **VERIFIED** (read in the pinned source _and_ covered by a test),
**IMPLEMENTATION DETAIL**, **UNKNOWN**. Oracle pinned at `scripts/oracle-sha.txt`
(`1118751f`); paths below are relative to the Excalidraw checkout.

## One summary, one revision

**VERIFIED** — Excalidraw reads each row with `getFormValue` (`actions/actionProperties.tsx:229`):
the value every target element shares (`reduceToCommonValue`), or the row's default when
they differ, which for most rows is `null`, so nothing is marked. The targets are the
selection plus the labels its shapes carry (`getTargetElements`).

Here the engine gives the whole panel in one pass: `selectionStyle()`
(`engine/crates/draw-engine/src/engine/selection_style.rs`), with `null` for a mixed
value, the same targets, and the oracle's row predicates (`textAlignable`,
`verticalAlignable`, and `canAlign` / `canDistribute` counted in arrange units). The
host asks again only when `styleRevision()` has moved. The revision moves on a selection
change, a style change, undo or redo, a text commit, and a peer's patch that touches a
selected element or its label. So the panel follows all of those without the host
tracking each one (`e2e/console.spec.ts`).

**IMPLEMENTATION DETAIL**: measured with criterion (`benches/editing.rs` ›
`selection_style`) on a shared 20-core host:

| selection                       | time    | before the fix below |
| ------------------------------- | ------- | -------------------- |
| 1,000 of 1,000                  | 237 µs  | 239 µs               |
| 5,000 of 5,000                  | 1.59 ms | 1.62 ms              |
| 5,000 of 5,000, JSON            | 1.60 ms | 1.60 ms              |
| 5,000 of 5,000, grouped in twos | 2.70 ms | 10.86 ms             |
| 1 of 5,000                      | 48.7 µs | 610 µs               |

The fix: counting arrange units (`edit::units`) found each element's unit by walking the
units found so far, which a selection of many groups made quadratic; it is one lookup by
group now. And `selection_is_group` copied the whole board to ask about one element; it
reads the scene in place now.

## What a style reaches

**VERIFIED** — `changeProperty(..., includeBoundText)` reaches a shape's label only for
the stroke colour and the opacity (`actionProperties.tsx`). The label keeps its own
background, width and dash. That holds for a label selected along with its shape too, as
Select All and a click on a group hold one: the summary reads it through its shape, so a
single labelled shape is "Rectangle", not "2 selected". Choosing a style for the selection
also makes it the next element's style (`currentItem*`). An element the patch leaves
unchanged keeps its version (`newElementWith`,
`packages/element/src/mutateElement.ts:170-172`). Covered by `ci_style_reach.rs`.

**VERIFIED** (source) — a click on a group selects every member with no lock filter
(`selectGroupsForSelectedElements`, `packages/element/src/groups.ts@1118751f:66-140`) and
`changeProperty` restyles every selected element
(`actions/actionProperties.tsx@1118751f:193-223`); the oracle's lock filter is the marquee's
alone (`packages/element/src/selection.ts@1118751f:33-34`, `:70-96`). So a locked member of
a group the selection carries takes the colour, the pasted style and its label's size
(`ci_style_reach.rs` › a locked member of a selected group is restyled). What a peer holds,
and the label of a shape a peer holds, are never reached (`engine/style.rs` › `restylable`).

The opacity slider previews on every move and commits on release. What a peer takes in
between is given back to them at once, as it was, and what they send is taken as it comes:
committed with the rest, the preview was stamped above their copy and a label they had typed
into went back to its old words (`engine/peers.rs`, `ci_selection_style.rs` › preview).

## Copy and paste styles

**VERIFIED** — `actions/actionStyles.ts:51-236`, ported as `copy_styles` / `paste_styles`.
Copy takes the first selected element in stacking order, plus its label. Paste applies
the shared style to every target:

- roundness only where the kind takes it. A text keeps its own, which it does not paint:
  the engine makes text with the default style's corners, where the oracle's has none
  (`packages/element/src/newElement.ts:105`). Its size and alignment are written only
  when they differ as read, so pasting a text's own style onto it is not an edit;
- a text's font from the source, or the defaults. From a shape, that is the family new
  text is written in, Excalifont (`sourceText.fontFamily || DEFAULT_FONT_FAMILY`,
  `actions/actionStyles.ts@1118751f:143`); from a text, its own family — a legacy text
  with none crosses as the system stack it is drawn in, so its twin is not moved. The
  line height comes with the family (`sourceText.lineHeight || getLineHeight(fontFamily)`,
  `:157`), so a shape's default style pasted on a new text changes nothing. The
  text is laid out again with its shape, which grows when the label no longer fits
  (`redrawTextBoundingBox(newTextElement, container)`, `:174`);
- except what a style may not change, which keeps its own: a loose locked element, what a
  peer holds, and the label of either (see Select All below);
- arrowheads only from an arrow to an arrow;
- a frame target keeps a transparent background and no roundness.

Ctrl/Cmd+Alt+C and +V are matched on `event.code`, as the oracle does, because Option+C
types "ç" on a Mac. The context menu carries both items, and its copy says "Copied
styles." as the keys do (`actions/actionStyles.ts:73`).

## Fonts

**VERIFIED** — the font family row is Excalidraw's FontPicker
(`components/FontPicker/*.tsx@1118751f`), in `InspectorFontPicker.svelte` over `fonts.ts`:
three quick picks — Excalifont "Hand-drawn", Nunito "Normal", Comic Shanns "Code"
(`FontPicker.tsx:42-61`) — and a trigger, "Show font picker", which Shift+F opens where
the row shows (`App.tsx:5921-5950`). The list puts the families the board's texts use
first, "In this scene", deprecated ones included and badged "old", then the rest that are
not deprecated, "Available fonts", each in label order and narrowed by a search that
ignores case (`FontPickerList.tsx:157-187`, `:283-291`). Shift+F goes back to the search,
Escape closes, Enter picks the hovered family, and the arrows walk the list round from the
family chosen (`keyboardNavHandlers.ts:17-68`). A hovered family is drawn on the canvas
and taken back when the pointer leaves or the list closes; it is not committed, and it is
skipped above 200 texts or 5,000 characters (`actionProperties.tsx:1220-1236`,
`engine/style.rs` › `preview_font_family`). While the list is open the quick picks and the
list go on marking the family chosen, not the one hovered (`:1395-1405`). A face is loaded
before any text is laid out in it (`:1302-1356`, `fonts.ts` › `loadFontFamily`): laid out
in a fallback first, a shape grown to hold its label keeps the growth
(`e2e/fontPicker.spec.ts`).

**VERIFIED** — Ctrl/Cmd+Shift+> and < step the font size a tenth up and down, each text from
its own size, `Math.round`ed; the next text's size moves only when every stepped text
ends the same (`actionProperties.tsx:1095-1141`, `:341-351`; `ci_next_style.rs`). They act
on the board and in the text being typed, as the oracle's editor runs them
(`wysiwyg/textWysiwyg.tsx:675-678`). The board's capture-phase style handler lets exactly
these chords through from the text editor; every other key typed there is text
(`shortcuts.ts` › `styleShortcut`, `shortcuts.test.ts` › typing).

**IMPLEMENTATION DETAIL** — the editor is asked for again after a step
(`editSelectedText`), so it takes the new size and place and keeps what was typed. A
text still being typed is not in the scene until its editor closes: its step is written
into it without a commit, so the commit that makes it is still one step of undo
(`engine/style.rs` › `relayout_selected_texts`, `ci_next_style.rs` › a text being typed).

## Arrows

**VERIFIED** — the Arrow type row sets sharp or curved on the selected arrows and on the
next one (`actionChangeArrowType`, `actionProperties.tsx:2057-2242`; the next is
`currentItemArrowType`, round until chosen). A new arrow takes its curve from it alone, so
the Edges row is not shown for arrows, as the oracle's `canChangeRoundness` leaves them
out. The arrowhead rows with nothing selected set the next arrow's heads
(`currentItemStartArrowhead` / `currentItemEndArrowhead`, `:1944-1982`), which a line
never takes (`ci_next_style.rs`, `e2e/arrowType.spec.ts`).

## Bound text

**VERIFIED** — the context menu's three bound-text actions
(`actions/actionBoundText.tsx`), between Group and Ungroup as the oracle lists them
(`App.tsx:13775-13780`), each offered on its own predicate, which `selectionStyle()`
answers (`canBindText`, `canUnbindText`, `hasFreeText`), and each one step of undo
(`engine/bound_text.rs`, `ci_bound_text_actions.rs`, `e2e/boundText.spec.ts`):

- **Bind text to the container** — exactly a free text and a shape or arrow with no label
  (`:128-154`): the text becomes its label, centred, laid out in it, directly above it in
  the stack, and the shape is left selected. The shape's height is remembered;
- **Unbind text** — each selected shape's label is free text again, its typed lines at
  their measured size where it was drawn, and the shape takes back the height remembered
  when a text was bound into it (`:69-121`);
- **Wrap text in a container** — each selected free text gets a rectangle in the next
  element's style, fully opaque, a padding clear of it, in its groups and frame and at its
  angle, directly below it; the arrows bound to the text are bound to the rectangle
  (`:269-376`).

"Enable text auto-resizing" sits with them, for one free text of a fixed width
(`actions/actionTextAutoResize.ts:27-34`). A right click on an element already selected
keeps the selection, so the menu acts on all of it (`App.tsx:13299-13319`,
`engine/src/host/pointerInput.ts`).

## Divergences

| what                            | Excalidraw                                                                                                                                                                                        | here                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S** with nothing selected     | opens the stroke picker under a drawing tool (`components/App.tsx:5895-5918`)                                                                                                                     | only with a selection. Our S is also the lasso key, which Excalidraw folds into the selection tool, and with nothing selected the key keeps that meaning                                                                                                                                                                                                  |
| eyedropper                      | its own sampler: it reads the canvas's pixels (`components/EyeDropper.tsx:107-120`), applies live while the pointer is held, and is also opened by holding Alt (`ColorPicker/ColorInput.tsx:141`) | the browser's `EyeDropper` API, Chromium only, opened by the button or **I**; no Alt hold and no live application. The button is absent where the API is                                                                                                                                                                                                  |
| arrowheads of a mixed selection | a non-arrow counts as the next element's arrowheads (`actionProperties.tsx:2002-2028`), so a box plus an arrow reads as mixed whenever the arrow's heads differ from those                        | read from the arrows only: a box plus an arrow shows the arrow's heads                                                                                                                                                                                                                                                                                    |
| top picks in the dark theme     | the same five values, painted through the dark-mode filter (`ColorPicker/TopPicks.tsx`)                                                                                                           | darker values of their own (`inspector.ts` › `DARK_*_SWATCHES`, which predates this package); the popover's grid uses the light palette as Excalidraw's does                                                                                                                                                                                              |
| Select All                      | skips labels and locked elements (`actions/actionSelectAll.ts:32-38`); a locked member of a group comes back with it (`selectGroupsForSelectedElements`) and is restyled                          | takes both, so locked elements can be unlocked from the menu (`edit/group.rs` › `carried_by`). A label is read and styled through its shape; a style chosen then passes a loose locked element and its label by, restyles a locked member of a group as the oracle does, and the panel reads only what it would change (`engine/style.rs` › `restylable`) |
| top picks                       | reorderable by drag and replaceable from a context menu (`ColorPicker/TopPicks.tsx:48`, `:75`)                                                                                                    | fixed                                                                                                                                                                                                                                                                                                                                                     |
| font quick picks                | rearranged by dragging a family onto them, and reset from a context menu (`FontPicker/fontTopPicksDnD.tsx`, `FontPicker.tsx:241-266`)                                                             | the three the oracle starts with, fixed                                                                                                                                                                                                                                                                                                                   |
| font size                       | the four presets and the Ctrl/Cmd+Shift+< / > steps (`actionProperties.tsx:999-1141`), with no ceiling                                                                                            | also a typed size, "Font size in pixels"; every size is kept within 1 to 1000, what the contract stores                                                                                                                                                                                                                                                   |
| a family's face loaded          | for the characters of the texts it is picked for (`actionProperties.tsx:1302-1356`)                                                                                                               | the shard the space is in, Latin; a text in another script is laid out in the fallback until its shard arrives, then laid out again (`fonts.ts` › `loadFontFamily`, `watchFonts`)                                                                                                                                                                         |
| whether text wraps              | no row: a free text wraps once a side handle sets its width, and "Enable text auto-resizing" in the context menu undoes that; a label always wraps                                                | a "Text wrap" row, Wrap or Grow, for free text (`autoResize`) and labels (the engine's `wrap`: a label that does not wrap widens its shape), shown only when one is selected. A selection holding both takes two steps of undo (`inspector.ts` › `wrapWrites`)                                                                                            |
| unbinding an arrow's label      | the remembered height is written onto any container (`actionBoundText.tsx:107-113`)                                                                                                               | an arrow keeps its geometry: its extent is its points                                                                                                                                                                                                                                                                                                     |
| bound text and locks            | the actions take whatever is selected                                                                                                                                                             | a loose locked element, and anything a peer holds, is passed by — the rule every style action follows (`engine/style.rs` › `restylable`)                                                                                                                                                                                                                  |

## Gaps

- **No number fields** for position, size or rotation. Those rows are not built;
  geometry is edited on the canvas.
- **No elbow arrows.** The Arrow type row offers sharp and curved; elbow routing is a
  milestone of its own. Pressing the arrow tool's key again does not cycle the type
  (`App.tsx:5695-5714`).
- **No Liberation Sans.** The file Excalidraw ships is Liberation 1.05, under a licence
  this project has not cleared (`apps/web/static/fonts/LICENSES.md`); the oracle's picker
  never lists it either, and a text in it is drawn in the fallback.
- **A right click inside the selection's box** but on no element opens the board's menu,
  where the oracle's opens the element menu (`isHittingCommonBoundingBoxOfSelectedElements`,
  `App.tsx:13280-13287`).
