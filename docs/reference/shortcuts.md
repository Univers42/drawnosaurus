# Shortcuts, overlays and the focus

One page for the chrome-wide keyboard architecture: which chord reaches the board, when an
open overlay stops it, and where the focus goes when that overlay closes. It is the page
for anything that is true of _every_ dialog and menu, so the per-area pages
(`docs/reference/palette.md`, `docs/reference/vectorize.md`, …) keep their own behaviour
and point here for the shared rule.

The chords themselves are in `shortcutRegistry.ts` (labels, the table the shortcuts dialog
prints) and `shortcuts.ts` (the pure decisions: `styleShortcut`, `appShortcut`,
`isTextField`, `insideDialog`, `insideOverlay`). The engine owns the canvas keys and the
keymap (`engine/src/host/keys.ts`); nothing below moves a key from the engine or adds one.

## Where a key goes

A **canvas** key — a tool, a nudge, a z-order chord — reaches the board only while the
board holds the focus. The engine's keyboard rides the focused container and nothing else
(`engine/src/host/keyboardInput.ts:33`, and that file's own header: "so the embedding page
does not steal them"), so a key pressed anywhere else is not seen by it at all. That one
fact is why an open overlay that takes the focus keeps the board's keys on the board, and
why an overlay that takes it and never gives it back leaves the board unreachable from the
keyboard.

The chrome's own chords are not on that footing, and the difference matters when reading
the guard below: `onAppShortcut` rides on the window (`DrawSurface.svelte:1891`), so it
sees a key wherever the focus is and is kept off an overlay by the guard rather than by the
focus. The style chords and the shape-switch chords ride the chrome root's capture-phase
`onkeydown` (`:1899-1906`), which is inside the same container, so they need the focus as
well as the guard.

`DrawSurface.svelte`'s `keyTarget` (`:472-479`) sorts the press into one of four:

| target       | what it is                                             | who answers              |
| ------------ | ------------------------------------------------------ | ------------------------ |
| `textEditor` | the textarea over the text being edited on the board   | the editor               |
| `field`      | any other input, textarea, select or `contenteditable` | typing                   |
| `overlay`    | inside a `role="dialog"` or a `role="menu"`            | the overlay              |
| `board`      | anything else                                          | the board and the engine |

## The target-relative guard, and what it does not cover

`insideDialog` and `insideOverlay` (`shortcuts.ts`) both ask the same question in two
widths, walking the ancestors of `event.target`:

- `insideDialog` — `[role="dialog"]`. It guards the app chords in `onAppShortcut`
  (`DrawSurface.svelte:1818`): with the shortcuts dialog open, `Ctrl+/` opens nothing on
  top of it and `?` does not stack a second one. Escape is exempt, because Escape is how
  the topmost overlay closes (`DrawModals.svelte`).
- `insideOverlay` — `[role="dialog"], [role="menu"]`. It guards the style chords
  (`styleShortcut`), because a colour picker open inside a menu takes `S` and `G` for its
  own swatches. It also answers `keyTarget`, which is what tells `appShortcut` a press
  landed in a menu — see the note below, because what `appShortcut` then _does_ with that
  answer is the opposite of what `styleShortcut` does.

The guard is deliberately **not** "is an overlay open". It answers _where the key landed_,
and that is the whole of what a DOM event knows. Two consequences, both real:

- a key pressed while the focus sits on a **toolbar button** with a dialog open still
  reaches the board. Closing that wants the open-overlay state `DrawModals.svelte` already
  keeps for Escape, plus a focus trap to go with it — neither is here.
- the **main menu** is a `role="menu"`, so `insideDialog` does not match it and the app
  chords reach it. That is the reason the two widths exist at all. `DrawMainMenu.svelte`
  prints **six** chords beside its own items — `Ctrl+O` (`:193`), `Ctrl+S` (`:204`),
  `Ctrl+Shift+E` (`:215`), `Ctrl+Alt+P` (`:256`), `?` (`:277`) and `Alt+S` (`:314`) — and a
  menu that advertises six chords and then ignores two is worse than one that prints
  nothing. Four of the six are handled inline in `onAppShortcut` and are unaffected by
  `appShortcut` entirely; the other two, `Ctrl+Alt+P` and `Alt+S`, route through it.

> **The menu is a trap for a guard, and it caught this app once.** Zen mode gave
> `appShortcut` a `KeyTarget`, and the first version of that guard answered `"overlay"`
> with `null`. `keyTarget` calls `insideOverlay`, which sees `[role="menu"]` — so both
> `Ctrl+Alt+P` and `Alt+S` silently stopped working, while the menu went on printing them.
> `e2e/shortcuts.spec.ts` could not see it: that test names `Alt+S` in its own comment for
> this exact reason but only presses `Ctrl+O`, the one of the four inline chords with
> something observable. `appShortcut` now guards `field` and `textEditor` only, and
> `zen.test.ts`, `shortcutRegistry.test.ts` and `e2e/zen.spec.ts` all pin the two menu
> chords as live.

`isOwnedElsewhere` (`DrawSurface.svelte:705-709`) is a _third_ copy of the overlay
selector, this one for drop and paste. It is unexported, untested, and omits
`[role="menu"]`. Pre-existing, recorded here rather than fixed: it is not a focus question
and folding it into `insideOverlay` is a change of its own.

## Zen mode: `Alt+Z`

The one chord in the app that is purely about the chrome, and the only one whose guard is
load-bearing rather than tidy.

**The chord.** `Alt+Z`, on `code` rather than `key`, is the oracle's `keyTest` read
literally — `!event[KEYS.CTRL_OR_CMD] && event.altKey && event.code === CODES.Z`
(`actionToggleZenMode.tsx@1118751f:34-35`). Shift is not in that test, so **`Alt+Shift+Z`
toggles it too**; that is the oracle's rule, not an oversight here. The registry entry is
`view.zenMode` in the View section, and `appShortcut` (`shortcuts.ts`) returns `"zen"`.
Nothing in the engine answers the chord: `keys.ts:300` returns `"pass"` for anything with
Alt held, and `handlePlainKeys` has no case for `Z`.

**What it hides** is `zen.ts`'s table — the oracle's own inventory, read off its CSS and
mapped onto this chrome. It is a _distraction reducer_, not a chrome hider, and the
difference is worth stating plainly because `shortkey.md:384` reads the other way:

| surface                                                          | in zen mode | the oracle                                                                                               |
| ---------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------- |
| the top bar — menu trigger, title, Share                         | **kept**    | never takes a zen class (`LayerUI.tsx@1118751f:241-244`)                                                 |
| the tool strip                                                   | **kept**    | the container takes `zen-mode` but the rule hides only two things inside it (`Toolbar.tsx@1118751f:250`) |
| the tools' key hints                                             | **hidden**  | `.ToolIcon__keybinding` and `.HintViewer` (`Toolbar.scss@1118751f:5-10`)                                 |
| the style panel                                                  | **hidden**  | `transition-left` → `translate(-999px, 0)` (`LayerUI.tsx@1118751f:253-255`)                              |
| the zoom controls                                                | **kept**    | see the dangling class below (`Footer.tsx@1118751f:40-42`)                                               |
| the undo and redo buttons                                        | **hidden**  | `--transition-bottom` → `translate(0, 92px)` (`Footer.tsx@1118751f:56-58`)                               |
| the path panel                                                   | **hidden**  | ours; the oracle has no presentation mode, and it is the same kind of side panel                         |
| the canvas, the text being edited, the canvas menu, every dialog | **kept**    | sibling containers, outside every zen rule (`App.tsx@1118751f:2529-2531`)                                |
| the "Exit zen mode" button                                       | **shown**   | `disable-zen-mode`, hidden until `disable-zen-mode--visible` (`Actions.tsx@1118751f:915-931`)            |

Two classes the oracle applies move **nothing**, because its CSS defines no rule for them,
and this app reproduces the behaviour rather than the intention:

- `layer-ui__wrapper__footer-left--transition-left` (`Footer.tsx@1118751f:42`) — the footer
  left holds the zoom actions _and_ the undo/redo row. Only `--transition-bottom` is defined
  (`LayerUI.scss@1118751f:63-65`), and it is on the undo/redo row. So zen mode takes undo
  and redo and leaves the zoom controls, which is why this app's `DrawZoomBar` loses exactly
  its undo/redo buttons and keeps the rest.
- `MenuTrigger`'s `zen-mode-transition` (`DropdownMenuTrigger.tsx@1118751f:19-26`) carries no
  direction at all, so the dropdown triggers do not move either.

`zen-mode-visibility` (`styles.scss@1118751f:665-679`) is dead CSS in the oracle — no TSX
uses it. Nothing here uses it either.

**One divergence this app makes on purpose.** The oracle also _withholds_ the action on a
phone: `actionToggleZenMode.tsx@1118751f:28-33` gates it on
`app.editorInterface.formFactor !== "phone"`, so on a phone Excalidraw has no Zen mode item
and the chord does nothing. This app has one layout for every form factor and no
`formFactor` at all, so the chord and the palette command are offered everywhere. Recorded
as a `ponytail:` note in `zen.ts`; a phone layout is a design decision, not a parity fix.

**The guard, and why the exit button is not decoration.** `appShortcut` takes the same
`KeyTarget` `styleShortcut` already takes and declines `field` and `textEditor` before it
looks at the key. That is the oracle's rule with a different name: its key dispatch is
wrapped whole in `if (!isInputLike(event.target))` (`App.tsx@1118751f:5516`), and ours is
`isTextField`/`insideDialog` (`shortcuts.ts:41`, `:84`). So `Alt+Z` typed into a text box or
a board title does nothing, and an open **dialog** stops it one level down, at
`insideDialog` in `onAppShortcut`. A **menu** does not, on purpose — see the trap note
above. Which is also why the exit button has to exist: a person part-way through a sentence
cannot press the chord to get out, and a feature that hides the chrome must not be able to
strand anyone who cannot see the key. The button appears only while the flag is on, bottom
right, and is the oracle's own answer to the same problem.

**Zen mode is refused while presenting, and that is a deliberate divergence.** `Alt+Z`
carries `&& !presenting`, the same guard the Present chord carries one line above it in
`appShortcut`. Presenting hides the exit button, the palette and the main menu, so a flag set
from in there would be on with no visible way to clear it — and the only key that clears it
would be the one that no longer reaches. The oracle does not make this distinction, because
its chrome stays reachable in its own presentation mode. Zen mode entered _before_ Present
survives the round trip: the button is hidden while the slides are up and is back on
leaving, and the chrome comes back still in zen.

## Focus

`takeFocus` (`focusHandback.ts`) is one function for the pair an overlay owes: focus
`into` on open, hand the focus back to the element captured on mount when it closes. It
is the oracle's own pair — `document.activeElement` captured on mount and `.focus()`ed from
`onClose` (`Dialog.tsx@1118751f:52`, `:99-104`), matching its take
(`Dialog.tsx@1118751f:63-68`, `Popover.tsx@1118751f:44-50`).

Fourteen overlays in this app. Twelve focus themselves on open and hand it back:

| overlay                | takes the focus on | the hand-back lands on                                |
| ---------------------- | ------------------ | ----------------------------------------------------- |
| `DrawMainMenu`         | the menu root      | the trigger button that opened it — see Known limits  |
| `DrawContextMenu`      | the menu root      | the board                                             |
| `DrawCommandPalette`   | the combobox       | the board, unless a command opened a dialog           |
| `DrawExportModal`      | the card           | where it came from — the board, opened from the board |
| `DrawShortcutsDialog`  | the card           | the board                                             |
| `DrawTemplatesModal`   | the card           | the board or the menu's trigger — see below           |
| `DrawShareModal`       | the card           | the board                                             |
| `DrawMermaidModal`     | the textarea       | the board                                             |
| `VectorizeDialog`      | the card           | the board — the canvas menu is gone by then           |
| `DrawPathPanel`        | the first stop     | the board or the menu's trigger — see below           |
| `InspectorColorPicker` | the picker         | the text being typed, else the board                  |
| `InspectorFontPicker`  | the search field   | the text being typed, else the board                  |

The export, templates, share, mermaid and path overlays are opened from the main menu by
`pick`, which runs the action and _then_ closes the menu (`:91-95`), so the menu is on its
way out as the dialog mounts. The captured element is either the departing menu item —
which the fallback below sends to the board — or the trigger the menu's own hand-back just
focused. No test asserts which, and the keyboard does not care: while the dialog is open
the card holds the focus either way, and once it closes the next key reaches whatever was
handed back.

Two take no focus on open, on purpose or as a known gap:

- **the More tools menu** (`DrawToolbar.svelte`) — the trigger's `holdFocus` calls
  `preventDefault` on mousedown (`:42-44`, wired at `:84` and `:116`), so the button never
  takes the focus, and the menu itself is never focused (`:112-127`, `:129-130`) — only an
  arrow key inside it moves the focus, which is a known limit below. The board keeps it,
  which is what the menu is for: every tool in it is one key away whether it is open,
  closed or never discovered. Escape is the one path that moves the focus, to the trigger
  (`:56-61`).
- **`DrawEmbedModal`** — its input carries `autofocus`, which a browser honours only for
  what was in the page as it loaded, so the dialog focuses nothing. That is BUNNY.md
  §10 Phase 1.5, still open.

Asserted in `e2e/shortcuts.spec.ts` (the export dialog, the shortcuts dialog and the
canvas menu: the board has the focus, the overlay takes it, Escape gives it back, the next
key is the board's) and in `e2e/share.spec.ts` and `e2e/templates.spec.ts` for the take.

### The hand-back when there is nowhere to go

`takeFocus` restores the captured element when it is still in the document, and otherwise
falls to `giveKeysBack` (`textEditor.ts:257-261`): the text being typed, else the board.
Two cases reach the fallback — the focus was on `<body>` when the overlay opened, or the
captured control went away with the overlay that opened this one, as the palette's input
does when a palette command opens a dialog. The oracle calls `.focus()` on a
`lastActiveElement` it never checks is still in the document, which in a browser is a call
on a detached node and no focus at all. `giveKeysBack` is this app's own rule that the
next key is a board key, reused rather than a second opinion invented here.

## Known limits

- **No focus trap.** Tab walks out of an open overlay, where the oracle cycles inside it
  (`Dialog.tsx@1118751f:70-94`, `Popover.tsx@1118751f:52-80`). No dialog in this app
  implements the handler. This is why the registry's focus-management rule is a `gap`.
- **The main menu hands the focus back to its trigger, not to the board.** WAI-ARIA-correct
  in isolation, and what the oracle's dialog does; but this app has no roving-focus model,
  so after Escape from the main menu the board holds nothing and `R` does not reach it
  until the board is clicked (`DrawMainMenu.svelte`). Changing that is a design decision
  about where the focus lives between the chrome and the canvas, not a bug fix, so it is
  recorded rather than quietly done.
- **The More tools menu's arrow keys take the focus and nothing gives it back.**
  `onMenuKeydown` focuses a `.menu-item` (`DrawToolbar.svelte:64-69`) and the only
  hand-off is its own Escape branch, so a menu dismissed by a press outside leaves the
  focus on a node that is being removed. Unlike the other two menus, no test opens it and
  presses an arrow key — the registry's menu-navigation rule says so — so this is read
  from the code, not observed.
- **A key pressed on a toolbar button with a dialog open still reaches the board.** The
  guard is target-relative; see above.
- **Zen mode's decision is unit-tested; its effect on the DOM needed a browser.** The web
  suite runs in vitest's `node` environment over `src/**/*.test.ts`
  (`apps/web/vite.config.ts`), so no Svelte component is rendered and no CSS is applied —
  and adding jsdom would be a new dependency. `zen.test.ts` proves the inventory, the
  chord and the guard, because `chromeVisible` is what the template reads.
  `e2e/zen.spec.ts` covers what that cannot: that the `{#if}`s in `DrawSurface.svelte`,
  `DrawZoomBar.svelte` and `DrawToolbar.svelte` are wired to the table, that the canvas and
  the scene survive, and that the exit button is legible rather than inheriting the chrome's
  button reset.
- **That last one was a real defect, and the irony is not lost.** A bare `.exit-zen-mode` at
  (0,1,0) loses to `.draw-chrome button` at (0,1,1) on padding, background, border, colour
  and — through that rule's `font: inherit` shorthand — size and weight, so the one control
  that has to be legible rendered as 16px body text on no background. A jsdom cascade check
  found it; a unit test could not have, and neither could a review that read the CSS without
  computing the cascade. It is scoped `.draw-chrome button.exit-zen-mode` now, and
  `e2e/zen.spec.ts` reads the three computed values back.
- **The exit button is hidden while presenting, and zen cannot be entered from there.** A
  deliberate divergence, recorded above: the chord carries `&& !presenting` because
  presenting hides every way out of the flag. The cost is that zen mode cannot be turned on
  or off by keyboard during a presentation, and the oracle allows both.
- **No shared dialog component.** Each overlay is its own `<div class="modal-backdrop"
role="dialog">`, its own Escape is one handler in `DrawModals.svelte` rather than one
  per dialog, and the focus pair (`takeFocus`) is what ten of the eleven dialogs now
  share, with nothing else factored out. The eleven independent
  `role="dialog"` sites are `DrawCommandPalette`, `DrawEmbedModal`, `DrawExportModal`,
  `DrawMermaidModal`, `DrawPathPanel`, `DrawShareModal`, `DrawShortcutsDialog`,
  `DrawTemplatesModal`, `InspectorColorPicker`, `InspectorFontPicker` and
  `VectorizeDialog`.
  So "the dialog" is never a single thing to fix, and an overlay added in a new place
  starts with no focus on open and no hand-back.
