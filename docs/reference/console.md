# The properties panel

Confidence markers: **VERIFIED** (read in the pinned source _and_ covered by a test),
**IMPLEMENTATION DETAIL**, **UNKNOWN**. Oracle pinned at `scripts/oracle-sha.txt`
(`1118751f`); paths below are relative to the Excalidraw checkout.

## One summary, one revision

**VERIFIED** — Excalidraw reads each row with `getFormValue` (`actions/actionProperties.tsx@1118751f:229`):
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
`packages/element/src/mutateElement.ts@1118751f:170-172`). Covered by `ci_style_reach.rs`.

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

**VERIFIED** — `actions/actionStyles.ts@1118751f:51-236`, ported as `copy_styles` / `paste_styles`.
Copy takes the first selected element in stacking order, plus its label. Paste applies
the shared style to every target:

- roundness only where the kind takes it. A text keeps its own, which it does not paint:
  the engine makes text with the default style's corners, where the oracle's has none
  (`packages/element/src/newElement.ts@1118751f:105`). Its size and alignment are written only
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
styles." as the keys do (`actions/actionStyles.ts@1118751f:73`).

## Fonts

**VERIFIED** — the font family row is Excalidraw's FontPicker
(`components/FontPicker/*.tsx@1118751f`), in `InspectorFontPicker.svelte` over `fonts.ts`:
three quick picks — Excalifont "Hand-drawn", Nunito "Normal", Comic Shanns "Code"
(`FontPicker.tsx@1118751f:61-208`) — and a trigger, "Show font picker", which Shift+F opens where
the row shows (`App.tsx@1118751f:5922-5951`). The list puts the families the board's texts use
first, "In this scene", deprecated ones included and badged "old", then the rest that are
not deprecated, "Available fonts", each in label order and narrowed by a search that
ignores case (`FontPickerList.tsx@1118751f:166-196`, `:292-300`). Shift+F goes back to the search,
Escape closes, Enter picks the hovered family, and the arrows walk the list round from the
family chosen (`keyboardNavHandlers.ts@1118751f:17-68`). A hovered family is drawn on the canvas
and taken back when the pointer leaves or the list closes; it is not committed — nor by a
typing session a press on the board ends while the list is open, which gives it back first
(`engine/text_session.rs` › `commit_text_edit`, `e2e/fontPicker.spec.ts`) — and it is
skipped above 200 texts or 5,000 characters (`actionProperties.tsx@1118751f:1223-1239`,
`engine/style.rs` › `preview_font_family`). While the list is open the quick picks and the
list go on marking the family chosen, not the one hovered (`:1395-1405`). A face is loaded
before any text is laid out in it (`:1302-1356`, `fonts.ts` › `loadFontFamily`): laid out
in a fallback first, a shape grown to hold its label keeps the growth
(`e2e/fontPicker.spec.ts`).

**VERIFIED** — Ctrl/Cmd+Shift+> and < step the font size a tenth up and down, each text from
its own size, `Math.round`ed; the next text's size moves only when every stepped text
ends the same (`actionProperties.tsx@1118751f:1095-1141`, `:341-351`; `ci_next_style.rs`). They act
on the board and in the text being typed, as the oracle's editor runs them
(`wysiwyg/textWysiwyg.tsx@1118751f:675-678`). The board's capture-phase style handler lets exactly
these chords through from the text editor; every other key typed there is text
(`shortcuts.ts` › `styleShortcut`, `shortcuts.test.ts` › typing).

**IMPLEMENTATION DETAIL** — while a text is typed, every style write — a size chord, a family,
any panel row — lands on it, and the editor reads its new family, size, colour and box back
at once through the style revision the write moves (`DrawSurface.svelte` › `refreshStyle`,
`DrawTextEditor.svelte` › `revision`, `text_edit_layout`), keeping what was typed: the quick
picks and the panel's buttons keep the focus, so the editor is still open when they write.
None is a step of its own: nothing is stamped or sent until the editor closes, and that
commit — typing and styles together — is one step of undo (`engine/selection_style.rs` ›
`commit_style`; `ci_text_edit.rs` › `style_while_typing`, `ci_next_style.rs` › a text being
typed, `e2e/fontSize.spec.ts` › one step). A family hovered in the list while typing is
given back as the hover found the text, what was typed included, as the oracle's picker
caches the editing text when it opens (`actionProperties.tsx@1118751f:1484-1499`).

## Arrows

**VERIFIED** — the Arrow type row sets sharp or curved on the selected arrows and on the
next one (`actionChangeArrowType`, `actionProperties.tsx@1118751f:2062-2251`; the next is
`currentItemArrowType`, round until chosen). A new arrow takes its curve from it alone, so
the Edges row is not shown for arrows, as the oracle's `canChangeRoundness` leaves them
out. The arrowhead rows with nothing selected set the next arrow's heads
(`currentItemStartArrowhead` / `currentItemEndArrowhead`, `:1944-1982`), which a line
never takes (`ci_next_style.rs`, `e2e/arrowType.spec.ts`).

## Polygons

**VERIFIED** — a line's `polygon` flag (Excalidraw's, `packages/element/src/types.ts@1118751f:382`)
marks it closed on its first point and filled like a shape rather than drawn as an open
stroke. Closing a multi-point line onto its own first point while drawing sets it
(`actionFinalize.tsx`, `engine/multi_linear.rs`); a two-point loop (three points once
closed) stays a segment, since `isValidPolygon` needs more than three
(`scene::geometry::is_valid_polygon`). The Close shape row does the same as a toggle,
gated on every selected line carrying at least four points
(`actionLinearEditor.tsx@1118751f:127-138`) and read pressed off `selectionStyle()`'s
`isPolygon`, `None` for a mixed selection the same way `arrowType` is; opening a polygon
clears its background, closing keeps it (`:159-164`). Dragging or removing the first or
last point keeps the two mirrored so a polygon stays closed, and removing a vertex below
three distinct points opens it (`selection/linear.rs`).

The flag is authoritative once set and never inferred from geometry: an older document's
line that happens to close a loop reads as open, because only an explicit `true` ever
promoted it, corrected back to `false` on load if its points no longer support it
(`restore.ts@1118751f:645-651`, `scene::element::normalize_polygon`). Render fill and the
inside hit-test stay geometric rather than flag-gated — `isPathALoop`, the same rule for
both (`shape.ts@1118751f:242-250`, `collision.ts@1118751f:820-860`) — so a hand-drawn or
bucket-filled closed line paints and picks up exactly like a toggled one; only the toggle,
the point-drag coupling and the JSON round trip read the flag itself
(`crates/draw-engine/tests/ci_polygon.rs`, `crates/draw-engine/tests/ci_line_multipoint.rs`).

## Bound text

**VERIFIED** — the context menu's three bound-text actions
(`actions/actionBoundText.tsx`), between Group and Ungroup as the oracle lists them
(`App.tsx@1118751f:13783-13788`), each offered on its own predicate, which `selectionStyle()`
answers (`canBindText`, `canUnbindText`, `hasFreeText`), and each one step of undo
(`engine/bound_text.rs`, `ci_bound_text_actions.rs`, `e2e/boundText.spec.ts`):

- **Bind text to the container** — exactly a free text and a shape or arrow with no label
  (`:128-154`): the text becomes its label, centred, laid out in it, directly above it in
  the stack, and the shape is left selected. The shape's height from before is remembered
  for as long as the oracle's `originalContainerCache` keeps it: a resize — by a handle,
  with others, or a flip, which the oracle does by resizing — forgets it
  (`handleBindTextResize`, `packages/element/src/textElement.ts@1118751f:174`), and a label that
  later grows the shape taller makes that the height remembered (`redrawTextBoundingBox`,
  `:119-127`; `ci_bound_text_actions.rs` › remembered_height). A label typed into a shape
  leaves, unless one is remembered already, the height the shape had when the editor
  opened on it — after a new label's shape grew to hold one line — as the oracle's editor
  caches it at its first layout (`wysiwyg/textWysiwyg.tsx@1118751f:326-345`); what typing
  grew is not kept. Here it is left at the commit, so an edit that came to nothing leaves
  nothing (`engine/text_session.rs` › `commit_text_edit`, `ci_text_edit.rs` › unbind);
- **Unbind text** — each selected shape's label is free text again, its typed lines at
  their measured size where it was drawn, in the shape's frame, and the shape takes back
  the height remembered, if one still is (`:69-121`). A label carries no frame here, its
  shape carrying membership for both (`zorder.md`), so the text takes the shape's, where
  the oracle's keeps the `frameId` its label carried (`ci_bound_text_actions.rs` › the
  text given back stays in the shape's frame);
- **Wrap text in a container** — each selected free text gets a rectangle in the next
  element's style, fully opaque, a padding clear of it, in its groups and frame and at its
  angle, directly below it; the arrows bound to the text are bound to the rectangle
  (`:269-376`). The frame is the text's even where the padding reaches past the frame's
  edge: the oracle sets it and judges nothing (`:313`; `ci_bound_text_actions.rs` › a text
  at a frame's edge keeps its frame).

"Enable text auto-resizing" sits with them, for one free text of a fixed width
(`actions/actionTextAutoResize.ts@1118751f:27-34`). A right click on an element already selected
keeps the selection, so the menu acts on all of it (`App.tsx@1118751f:13307-13327`,
`engine/src/host/pointerInput.ts`). A right click on a label is one on its shape: the
menu's hit leaves bound text out and counts a point on it as one on its container
(`getElementsAtPosition`, `App.tsx@1118751f:6727-6737`; `hitElementBoundText`,
`packages/element/src/collision.ts@1118751f:255-279`), so Unbind text is offered where the words
are (the engine's `hit_test`; `ci_bound_text_actions.rs` › context_menu,
`e2e/boundText.spec.ts`).

## Divergences

| what                            | Excalidraw                                                                                                                                                                                                          | here                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S** with nothing selected     | opens the stroke picker under a drawing tool (`components/App.tsx@1118751f:5896-5919`)                                                                                                                              | only with a selection. Our S is also the lasso key, which Excalidraw folds into the selection tool, and with nothing selected the key keeps that meaning                                                                                                                                                                                                  |
| eyedropper                      | its own sampler: it reads the canvas's pixels (`components/EyeDropper.tsx@1118751f:107-120`), applies live while the pointer is held, and is also opened by holding Alt (`ColorPicker/ColorInput.tsx@1118751f:141`) | the browser's `EyeDropper` API, Chromium only, opened by the button or **I**; no Alt hold and no live application. The button is absent where the API is                                                                                                                                                                                                  |
| arrowheads of a mixed selection | a non-arrow counts as the next element's arrowheads (`actionProperties.tsx@1118751f:2007-2033`), so a box plus an arrow reads as mixed whenever the arrow's heads differ from those                                 | read from the arrows only: a box plus an arrow shows the arrow's heads                                                                                                                                                                                                                                                                                    |
| top picks in the dark theme     | the same five values, painted through the dark-mode filter (`ColorPicker/TopPicks.tsx`)                                                                                                                             | darker values of their own (`inspector.ts` › `DARK_*_SWATCHES`, which predates this package); the popover's grid uses the light palette as Excalidraw's does                                                                                                                                                                                              |
| Select All                      | skips labels and locked elements (`actions/actionSelectAll.ts@1118751f:32-38`); a locked member of a group comes back with it (`selectGroupsForSelectedElements`) and is restyled                                   | takes both, so locked elements can be unlocked from the menu (`edit/group.rs` › `carried_by`). A label is read and styled through its shape; a style chosen then passes a loose locked element and its label by, restyles a locked member of a group as the oracle does, and the panel reads only what it would change (`engine/style.rs` › `restylable`) |
| top picks                       | reorderable by drag and replaceable from a context menu (`ColorPicker/TopPicks.tsx@1118751f:50`, `:88`)                                                                                                             | fixed                                                                                                                                                                                                                                                                                                                                                     |
| font quick picks                | rearranged by dragging a family onto them, and reset from a context menu (`FontPicker/fontTopPicksDnD.tsx`, `FontPicker.tsx@1118751f:241-266`)                                                                      | the three the oracle starts with, fixed                                                                                                                                                                                                                                                                                                                   |
| font size                       | the four presets and the Ctrl/Cmd+Shift+< / > steps (`actionProperties.tsx@1118751f:999-1141`), with no ceiling                                                                                                     | also a typed size, "Font size in pixels"; every size is kept within 1 to 1000, what the contract stores                                                                                                                                                                                                                                                   |
| a family's face loaded          | for the characters of the texts it is picked for (`actionProperties.tsx@1118751f:1305-1359`)                                                                                                                        | the shard the space is in, Latin; a text in another script is laid out in the fallback until its shard arrives, then laid out again (`fonts.ts` › `loadFontFamily`, `watchFonts`)                                                                                                                                                                         |
| whether text wraps              | no row: a free text wraps once a side handle sets its width, and "Enable text auto-resizing" in the context menu undoes that; a label always wraps                                                                  | a "Text wrap" row, Wrap or Grow, for free text (`autoResize`) and labels (the engine's `wrap`: a label that does not wrap widens its shape), shown only when one is selected. A selection holding both is one engine call and one step of undo (`engine/style.rs` › `set_text_wrap`)                                                                      |
| unbinding an arrow's label      | the remembered height is written onto any container (`actionBoundText.tsx@1118751f:107-113`)                                                                                                                        | an arrow keeps its geometry: its extent is its points                                                                                                                                                                                                                                                                                                     |
| bound text and locks            | the actions take whatever is selected                                                                                                                                                                               | a loose locked element, and anything a peer holds, is passed by — the rule every style action follows (`engine/style.rs` › `restylable`)                                                                                                                                                                                                                  |
| unbinding a mirrored shape      | never met: its shapes have no negative extent                                                                                                                                                                       | the height is remembered upright and given back with the sign the shape has now, so a shape that growth turned upright stays on the edge it grew from (`engine/bound_text.rs` › `unbind_text`)                                                                                                                                                            |

## Gaps

- **No number fields** for position, size or rotation. Those rows are not built;
  geometry is edited on the canvas.
- **No elbow arrows.** The Arrow type row offers sharp and curved; elbow routing is a
  milestone of its own. Pressing the arrow tool's key again does not cycle the type
  (`App.tsx@1118751f:5696-5715`).
- **No Liberation Sans.** The file Excalidraw ships is Liberation 1.05, under a licence
  this project has not cleared (`apps/web/static/fonts/LICENSES.md`); the oracle's picker
  never lists it either, and a text in it is drawn in the fallback.
