# Command palette and keyboard-only diagramming

Styled after Excalidraw's own command palette — fuzzy search, grouped categories, a
shortcut beside each entry (`CommandPalette.tsx@1118751f:560-779`) — built from a plain
`.ts` registry (`apps/web/src/lib/draw-chrome/commandPalette.ts`) rather than hardcoded in
the Svelte dialog, so the fuzzy matching, the grouping and the registry itself are unit
tested without mounting anything. `DrawCommandPalette.svelte` is a thin list over it.

## Opening it

`Ctrl/Cmd+/` and `Ctrl/Cmd+Shift+P` — the oracle's own toggle chord
(`CommandPalette.tsx@1118751f:145-146`). Both are wired in `DrawSurface.svelte`'s
`onAppShortcut`, the same window-level handler that already owns `Ctrl+O`/`Ctrl+S`/`?`, so
typing in a text field is never intercepted (`isTextField`) and neither is a key pressed
inside an open dialog (`insideDialog` in `shortcuts.ts`) — with the shortcuts dialog open,
`Ctrl+/` opens nothing on top of it. The guard is dialogs only, because the main menu is a
`role="menu"` that holds the focus and prints `Ctrl+O`/`Ctrl+S` beside its own items, so
the chords it advertises still reach it; the style chords ask the wider question and stop
at a menu too (`insideOverlay`). `docs/reference/shortcuts.md` has both rules in full.

## What it lists

`buildCommands` (`commandPalette.ts`) turns real host actions into commands — nothing is
duplicated by hand:

- every toolbar tool (`ALL_TOOL_DEFS`, `tools.ts`), with its own hotkey shown beside it;
- **Add rectangle / diamond / ellipse** — keyboard-only diagramming, below;
- zoom in/out/reset, fit, zoom to selection, grid and snap toggles, focus mode, **zen mode**
  (`Alt+Z`), Present;
- theme (light/dark/system);
- Export, Templates (`docs/reference/templates.md`);
- every style preset, built-in and saved (`stylePresets.ts`, `docs/reference/
stylePresets.md`), each its own command;
- one command per font family, and **Vectorize image…** — below.

## What it remembers

`paletteGroups(commands, query, lastUsedId)` takes **one** id, not a history, and the
oracle's palette does not keep a most-recently-used _list_ either. It is worth spelling out
because the cheap reading — "keep an array, sort by `lastUsed` descending" — is a
different and worse palette, and the oracle's answer to each question is specific:

- **What is remembered is one command.** `lastUsedPaletteItem` is
  `atom<CommandPaletteItem | null>(null)` (`CommandPalette.tsx@1118751f:85`) — a single
  item, so the cap is 1. Here the cap is structural: the function is handed one id, so a
  history cannot be expressed.
- **Running is what counts; being selected is not.** `executeCommand` fills the memory
  after `perform` (`:665`). Hovering a row (`:933`, `:951`) and arrowing onto one (`:710-778`)
  move the _highlight_ and never reach it. `DrawCommandPalette.svelte` keeps the same split:
  `runActive` is the only writer of `recentId`, `onmouseenter` only moves `activeIndex`.
- **A command that was never run is never demoted.** The list is sorted by category rank
  alone — `order` from `getCategoryOrder` (`:97-114`, assigned `:613`, compared `:837` and
  `:842`). The run command does not jump the queue; it is _lifted_ into a group of its own
  above the list and **taken out of the category it was declared in** (`:844-857`), rendered
  under a "Recents" heading (`:915-938`, `t("commandPalette.recents")` at `:918`). So exactly
  one row moves and every other row keeps the index it had. A usage sort does the opposite:
  it ranks used commands above never-used ones, which pushes down precisely the commands a
  new user is looking for.
- **Ties cannot arise**, and the order is otherwise declaration order: one item in the
  recents group, and the grouping keeps first-seen category order and never sorts within a
  category. The same list comes out on every render, and re-running a command does not
  reshuffle the rows under the pointer.
- **A category the run command emptied loses its heading** — the oracle's
  `getNextCommandsByCategory` (`:819-830`) only creates a key when a command lands in it.
  `groupCommands` over the commands that are left does the same here.
- **A query hides it.** `showLastUsed` needs an empty search (`:844-845`): the ranked
  results are the answer, and a recents heading above them would be a category the search did
  not match.
- **It does not persist.** The atom lives in `editorJotaiStore`, a plain `createStore()`
  with no storage (`editor-jotai.ts`), and `lastUsed` appears nowhere else in the oracle — not
  in `appState`, so a board change does not touch it, and a reload starts over. Here it is a
  `$state` in `DrawSurface.svelte`, deliberately: the dialog unmounts on close, so the memory
  has to outlive it.

Matched by `Command.id` where the oracle matches by `label` (`:622-624`, `:852`): the oracle
rebuilds its commands on every open and has nothing else to hold, while ours carry an id
that is unique (a `buildCommands` test holds that) and stable — so two commands cannot share
a label and have the wrong one lifted.

## What the oracle's palette does not have

Two of the three things added here are **not** ports, and are written here so nobody reads
them as parity:

- **Font families.** The oracle's palette has no font command at all:
  `defaultCommandPaletteItems.ts` is `export {}` — a one-line empty module — and
  `changeFontFamily` is a properties-panel action (`actionProperties.tsx@1118751f:1164`,
  rendered by `Actions.tsx:189`), never a palette entry. These commands are built from _its_
  font data anyway: `FONT_CHOICES` (`fonts.ts`, itself transcribed from
  `FontPickerList.tsx@1118751f:126-155`), gated on `can.text` — the row the panel shows
  (`shapeActions.ts:143-144`) — and applied through the same `applyStyle` patch the panel's
  own picker applies. The panel is out of the keyboard's reach while a shape is selected,
  which is why the other style rows exist.
- **Vectorize.** No vectorize command exists in the oracle's palette, at any category, at
  `@1118751f`. The palette's row _is_ the canvas menu's, from the one declaration
  (`menu.ts` › `vectorizeAction`), so the two cannot drift; `menu.test.ts` scans both files
  for the label literal to keep a second copy from coming back.
  `docs/reference/vectorize.md` has the dialog.

## Keyboard-only diagramming

"Add rectangle / diamond / ellipse" inserts a default-sized shape (120×60) centred on the
viewport, selected, as one step of undo — `DrawEngine::insert_default_shape`
(`engine/crates/draw-engine/src/engine/insert.rs`), exposed as `insertDefaultShape` on the
wasm boundary and `engine.ts`. The oracle's palette has no equivalent action to port at
`@1118751f`, so the size is this project's own pick, chosen to read as an immediately
useful flowchart node.

The point coordinates are **screen space**, like every other pointer-driven insert
(`insert_image`/`insert_embed`, `image.rs`) — `DrawSurface.svelte`'s `viewportCentre()`
gives the palette the same point `insertEmbed` already uses, and the engine converts it
with `screen_to_world` before placing the shape. A camera that has panned or zoomed still
gets the shape in the middle of what is actually on screen.

Once inserted and selected, nothing else is new: `Ctrl/Cmd+Arrow` (flowchart mode,
`docs/reference/flowchart.md`) and `Enter` (focus mode's type-in-the-node,
`docs/reference/camera.md`) work on it immediately, because both already act on whatever
is selected, however it got selected.

## The Present chord moved

Presentation mode used to answer to `Ctrl/Cmd+Shift+P`; the palette takes that chord now
(matching the oracle), so Present moved to **`Ctrl/Cmd+Alt+P`**, matched on `event.code`
rather than `event.key` — on a Mac, Option+P types "π". Picked because it is:

- unused in the oracle's own keymap (`shortcuts.ts@1118751f:59-115`);
- not `Ctrl+Shift+P`, which Firefox reserves for a private window;
- not an Alt+Shift combo, which some Windows/Linux layouts use to switch input language;
- consistent with this project's own precedent of trusting a Ctrl/Cmd+Alt chord — copy/
  paste styles already use `Ctrl/Cmd+Alt+C`/`+V`.

Updated everywhere the old chord was written down: `DrawShortcutsDialog.svelte`,
`DrawMainMenu.svelte`, `e2e/presentation.spec.ts`, `docs/reference/presentation.md`.

## Accessibility

`role="dialog"` with `aria-modal`; the input is `role="combobox"` with
`aria-expanded`/`aria-controls`/`aria-activedescendant` pointing at the highlighted
`role="option"` in the `role="listbox"` results — the same combobox/listbox pattern the
oracle's own palette uses. Arrow keys move the highlight, wrapping from the last result
back to the first and back; Enter runs the highlighted command and closes; Escape closes without
running anything, same as `DrawModals`' own stacked-dialog Escape handler, which also
knows about this layer. Closing returns keyboard focus to whatever had it before the
palette opened — the board, most often — captured on mount and restored on close
(`takeFocus`, `docs/reference/shortcuts.md` › Focus), unless the command it ran opened a
dialog of its own, which then keeps the focus.

## Known limits

- Fuzzy matching is a small substring/subsequence scorer
  (`matchScore` in `commandPalette.ts`), not the oracle's own matching library — it ranks
  an exact substring above a scattered one and an earlier match above a later one, which
  covers a command palette's usual queries without a new dependency for it.
- **The remembered command is not persisted** — a reload forgets it, as it does in the
  oracle. It is also _hidden_ while the command is not offered (it was selection-dependent
  and the selection changed), and back if it returns. **That is a divergence from the
  oracle, which forgets it outright**: `:621-624` re-resolves the remembered item against
  the current command list and stores `null` when it is gone, so it never comes back. Ours
  keeps the id and lets the `commands.some(...)` guard in `paletteGroups` decide
  (`commandPalette.ts:141`). The difference is invisible except across a selection
  round-trip — select an image, run Vectorize, deselect, reselect, and the oracle's palette
  would have forgotten it by the last step while ours offers it again. `isCommandAvailable`
  (`:915`, `:932`) only _hides_ the row; nothing in the oracle's palette nulls the atom
  except `:621-624`.
- **No recents while searching.** A query outranks the memory entirely, as in the oracle,
  so "toggle" finds the command but the recents heading is gone.
- **The recents group is a bare label.** The oracle's heading carries a
  `historyCommandIcon` beside the words (`CommandPalette.tsx@1118751f:919-926`); ours is
  text only, like every other group heading this palette draws.
