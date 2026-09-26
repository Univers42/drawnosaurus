# Presentation mode

Not a transcription of anything in the oracle — Excalidraw+'s presentation mode is a paid
feature with no source to read, so this is a fresh design against `prompt/shortkey.md`'s
"Presentations" checklist and the laser-pointer lines it references. The pure logic lives
in `apps/web/src/lib/draw-chrome/presentation.ts` (slide selection, key handling, the
counter text) and the camera math it shares with the rest of the chrome, in
`apps/web/src/lib/draw-chrome/camera.ts` (`fitCamera`, `easeInOutCubic`, `animateCamera`).
Both are plain, tested functions with no engine or DOM in them; `DrawSurface.svelte`
wires them to the board.

## Slides: the path

The board's frames, in path order (`slidesFromScene`):

- Frames the path editor placed come first, by the step it gave each. The step is the
  frame's own `pathStep` field (engine `scene/element.rs`, contract `element.ts`).
- Frames it never placed follow in the order they were made. Z-order is array position
  (see the root `CLAUDE.md` › "Server"), which is also creation order, and the sort is
  stable. So a board nobody ordered presents exactly as it did before the path existed.
- A board with no frames presents as **one slide**, fit to everything on it
  (`sceneBounds`/`elementBounds` from `packages/contract`).
- Frame titles are not drawn while presenting.

The step lives on each frame, not in a list on the board. Moving one stop writes only the
frames whose step changed, and two people reordering at once merge element by element,
like any other edit.

## The path editor

Prezi's path sidebar (`DrawPathPanel.svelte`), opened from the main menu or the palette
("Presentation path…"):

- It lists every frame as a numbered stop, and each frame on the board wears its number
  on its corner (`pathBadges`).
- A click on a stop flies the camera there, as Present will.
- A drag, Alt+↑/↓, or the ↑/↓ buttons move a stop. The focus stays on the stop that moved.
- Each move is one call to `engine.setPresentationPath(ids)`. That numbers the frames
  0, 1, 2… as one step, so one undo takes a reorder back.
- **Present** at the bottom starts the show from the first stop.
- Escape closes the editor.

## Entering and moving around

**Present**, from the main menu, the command palette, or `Ctrl/Cmd + Alt + P`. Track B's
command palette (`docs/reference/palette.md`) took the oracle's own toggle chord,
Ctrl/Cmd+Shift+P (`CommandPalette.tsx@1118751f:145-146`), so Present moved to Ctrl/Cmd+Alt+P —
unused in the oracle's own keymap, not Ctrl+Shift+P (Firefox's private-window chord) or an
Alt+Shift combo (an OS layout switcher on Windows/Linux), and matched on `code` rather than
`key` since Option+P types "π" on a Mac — the same reasoning already applied to the copy/paste
style shortcuts (Ctrl/Cmd+Alt+C/V). Entering:

- flies the camera to the first slide (below; `prefers-reduced-motion` jumps straight to
  it);
- hides the header, toolbar, inspector, zoom bar and every menu;
- dims everything on the board outside the current frame, with four plain CSS bands
  computed from the frame's on-screen rect (`dimBands` in `DrawSurface.svelte`) rather
  than an SVG mask — simpler, and there is only ever one rectangular hole;
- asks the browser for fullscreen, without failing if it is refused (headless browsers,
  and some embedded contexts, never grant it);
- forces the tool to the laser (see below).

| Key                                 | Does               |
| ----------------------------------- | ------------------ |
| `→` `↓` `Space` `Page Down` `Enter` | Next slide         |
| `←` `↑` `Page Up` `Backspace`       | Previous slide     |
| `Home` / `End`                      | First / last slide |
| a number, then `Enter`              | That slide         |
| `B` or `.`                          | Blank black        |
| `W` or `,`                          | Blank white        |
| `Esc`                               | Exit               |

These are PowerPoint's keys, which are also what a presentation clicker sends: Page
Up/Down, and `B` or `.` for its blank button. A blanked screen covers everything. The
next key, or a click, brings the slide back as it was, without stepping.

### The flight between stops

The camera travels van Wijk & Nuij's path, "Smooth and efficient zooming and panning"
(InfoVis 2003), which is Prezi's transition (`camera.ts` › `flight`).

- Between stops far apart, it zooms out on the way, so the next stop comes into view
  while the camera travels, then zooms back in to land.
- Into a frame nested in the one on screen, it is a zoom about their shared centre.
- A flight takes 700ms per unit of its length (ρ = √2, zoom counted in e-folds), held
  between 400 and 1800ms.
- It is eased at both ends, and lands with `setCameraExact`. Follow flies the same way.
- `e2e/presentationPath.spec.ts` walks a 10-frame nested path and checks:
  - each stop lands within 1px of its fit;
  - every frame drawn on the way fits a 60Hz budget (`p95CpuMs`);
  - the flight between two sibling scenes pulls back past both.

A resize refits the current slide instantly (no easing — a resize is not a gesture with a
"before"). Every key but `Tab` is caught before it reaches the engine's own listener, so a
stray letter cannot swap tools or start editing mid-show; `Tab` is left alone so the
presenter bar's own controls stay reachable from the keyboard. The bar (Prev / "3 / 7" /
Next / Exit) fades two seconds after the pointer last moved and returns on the next move —
cosmetic only, `pointer-events: none` while faded rather than removed, so every control
stays focusable the whole time.

Exiting — `Esc`, the bar's Exit button, or the menu again — restores the camera and the
tool exactly as they were before Present, leaves fullscreen if it was granted, and tells
any peer whose Follow was tracking this show that it ended (`present-end`).
In fullscreen the browser keeps `Esc` for itself and the page never sees it, so leaving
fullscreen — by `Esc` or any other way — ends the show too (`onFullscreenChange`).

## Nothing is editable

The engine has no `view_mode`, so presenting blocks edits by forcing the tool to
`"laser"` — already a pure client-side gesture the engine never turns into an element,
history entry or autosave patch (`engine/crates/draw-engine/src/engine/pointer.rs`, `pointer_end.rs`).
A drag while presenting is the laser pointer: a trail on screen, visible to peers the same
way it already was outside Present (`peerLaser.ts`), and nothing added to the scene. No
engine change was needed for this or for the camera moves above — `panBy` followed by
`zoomAt` anchored at the camera's own post-pan point lands on an arbitrary `{x, y, scale}`
exactly, which is what `setCameraExact` in `camera.ts` composes them into.

## Follow

While someone presents, everyone else on the board sees "_name_ is presenting" with a
**Follow** button (`DrawFollowNotice.svelte`). Following tracks their slide with the same
fit and easing, until `Esc` or a pan of the follower's own — either lets go without
fighting the gesture that caused it (`following` is cleared in `onCameraChange` unless the
camera move was the follow's own, tracked by a `followDriving` flag around it).

The wire gained one additive pair, `present` / `present-end`
(`apps/web/src/lib/realtime/realtimeClient.ts`), modelled on the existing `preview` /
`preview-end`: sent on entering Present and again on every slide change, carrying the
frame's id or `null` for a frame-less board's one slide. An old client that has never
heard of the type simply falls through `handleMessage`'s chain and ignores it — the same
way every other addition to this wire has been backward-compatible. A follower resolves
the id against **their own** local scene (`slidesFromScene`, the same pure function
Present itself uses) — the wire never carries bounds, only which frame.
The slide is also repeated with every `presence` — on each join and heartbeat — so someone
who opens the board mid-show sees the notice at once rather than at the next slide.

## Known limits

- Every frame is a stop, and each is visited once. The path cannot skip a frame or come
  back to one: Prezi can do both.
- A frame drawn after the path was set goes to the end of it.
- Following tracks the presenter's _slide_, not a live view of their camera between
  slides — if they pan within one, a follower's camera does not move until the next
  `present`.
- No pointer/telestration beyond the laser: this is the existing laser pointer, not a
  drawing tool for annotating over a presentation.
