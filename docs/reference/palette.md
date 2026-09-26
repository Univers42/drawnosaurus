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
typing in a text field is never intercepted (`isTextField`).

## What it lists

`buildCommands` (`commandPalette.ts`) turns real host actions into commands — nothing is
duplicated by hand:

- every toolbar tool (`ALL_TOOL_DEFS`, `tools.ts`), with its own hotkey shown beside it;
- **Add rectangle / diamond / ellipse** — keyboard-only diagramming, below;
- zoom in/out/reset, fit, zoom to selection, grid and snap toggles, focus mode, Present;
- theme (light/dark/system);
- Export;
- every style preset, built-in and saved (`stylePresets.ts`, `docs/reference/
stylePresets.md`), each its own command.

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
palette opened — the board, most often — captured in `DrawCommandPalette.svelte`'s
`onMount`/`onDestroy` rather than assumed.

## Known limits

- Fuzzy matching is a small substring/subsequence scorer
  (`matchScore` in `commandPalette.ts`), not the oracle's own matching library — it ranks
  an exact substring above a scattered one and an earlier match above a later one, which
  covers a command palette's usual queries without a new dependency for it.
