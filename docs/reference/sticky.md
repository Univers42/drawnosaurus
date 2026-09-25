# Sticky notes

Markers: **OBSERVED**, **VERIFIED**, **INFERRED**, **IMPLEMENTATION DETAIL**, **UNKNOWN**.

Oracle pinned at `scripts/oracle-sha.txt` (1118751f): `packages/element/src/stickyNote.ts`,
`resizeElements.ts`, `actions/colorTargets.ts`, `App.tsx:11812-11890` for the tool.

## One element

**VERIFIED** — a note is one `stickynote` element and a normal bound text, as the
oracle's. The shadow, the clipped edge and the date footer are painted on the canvas
(`wasm/paint.rs` › `paint_sticky`) and in the SVG export (`export/svg.rs` › `sticky_svg`),
not stored. The note is `is_rect_like`: it binds arrows, hides what is under it, takes a
bucket fill and a label like a rectangle.

The wire gains three optional fields, all absent on everything else, so a board without
notes is byte-identical (`packages/contract/tests/element.test.ts`,
`apps/api/tests/integration/boards.test.ts` › sticky, `ci_sticky.rs` › the_file):
`baseHeight` (the height asked for, which the note grows above for its text), `created`
(the date in the footer) and, on a label, `baseFontSize` (the size picked, which the fit
shrinks under and never grows past).

Constants, from the oracle: padding 16; footer 20 high, 12px Helvetica, baseline 14 from
the bottom, the year dropped under a body of 80; body inset 52; default 250, least 75;
shadow offset 3 at 0.16; edge 0.5 wide at 0.08; font fit from the picked size down in
steps of 2 to 16, then the note grows down (`ci_sticky.rs` › layout).

## The tool

**VERIFIED** — N (no digit: 9 stays the image tool's). A click places a 250 square centred
on it; a drag sizes a square unless Shift is held, keeping the far edge, and at release it
is held to one line of the next size. The label opens through the text session and a note
left empty keeps no label (`ci_sticky.rs` › the_tool, `e2e/stickyNote.spec.ts`). The host's
own four-element note (`createStickyNote`) and its window-level `n` listener are gone.

## Colours

**VERIFIED** — notes are their own colour domain (`resolveColorTarget`): the engine
reports `strokeDomain` / `backgroundDomain` (`regular`, `sticky`, `mixed`) in
`selectionStyle()`. In the sticky domain the panel offers `STICKY_NOTE_BACKGROUND_PICKS`
(`#ffdf6b #fcc2d7 #b2f2bb #a5d8ff #ffd8a8`), calls the stroke row "Text color" and hides
transparent. A background pick on a note's label colours its note; a note and its label
end with one ink, the side that changed winning (`syncStickyNoteInk`). With nothing
selected, a pick under the N tool sets the next note's colours only.

## Where this departs from the oracle

| divergence                                                                                                                                                                                                                                                           | why                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `created` is set on notes only; the oracle stamps every element.                                                                                                                                                                                                     | Only the footer reads it; stamping every element would change every board's bytes.                |
| `created: null` round-trips as absent.                                                                                                                                                                                                                               | The contract's optional fields are undefaulted; null and absent mean the same thing: no date.     |
| The resize minimum (one line) is taken at the ceiling the gesture started with, not the live one.                                                                                                                                                                    | The live ceiling shrinks each move, so the minimum depended on how many moves a drag was cut in.  |
| No from-centre (Alt) resize, and no corner-radius handle on a note.                                                                                                                                                                                                  | The engine has neither for any shape but the rectangle's radius handle; not added for notes here. |
| Shift at release of a drag-to-size is the Shift of the last move.                                                                                                                                                                                                    | The engine's pointer-up carries no modifiers.                                                     |
| Off the browser (the Rust tests) dates are read in UTC; in the browser, local time as the oracle.                                                                                                                                                                    | No time zone database in the native build.                                                        |
| A label migrated without a `fontFamily` keeps the legacy metrics and is not re-laid when fonts load.                                                                                                                                                                 | `fonts_loaded` re-lays texts that name a family only, as for every legacy text.                   |
| Boards saved with the old four-element note are migrated on load, open and paste (`apps/web/src/lib/notes/stickyNotes.ts`): a group of exactly a shadow, a pad, a free date text and at most the pad's label; a yearless date takes the latest year not after today. | Recognised by shape, never id: a paste re-mints ids. Anything else is left as it is.              |

**VERIFIED** — a migrated page's live seeding carries the migration's tombstones, not only
its live elements: `+page.svelte` builds `Scene` from `[...elements, ...migrated.removed]`,
so both `DrawSurface`'s `engine.setScene()` and its `liveBroadcast.reset()` read them
(`DrawSurface.svelte` ~950). A peer tab still holding the pre-migration shadow and date
then answers this page's `join` with them at their old stamp, and both sides refuse the
resurrection on stamp alone: the live broadcaster's inventory already advertises a newer
(tombstoned) copy, so a peer computing what this page is missing does not resend them
(`liveBroadcast.ts` › `missing`); and if a copy arrives anyway, the engine's own scene —
loaded with the tombstones as deleted elements — refuses it the same way it refuses any
stale remote edit (`apply_remote_patch_step`, `engine/clipboard.rs`; native evidence in
`ci_live_sync.rs` › `a_tombstone_loaded_at_boot_refuses_a_stale_remote_copy`). Reloading the
stale tab still ends the discrepancy for good, since it runs the migration too.
