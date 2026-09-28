# Style presets

Named bundles of style — pick one and every new shape starts looking like it, or restyle a
selection to match in one step. Pure logic in `apps/web/src/lib/draw-chrome/
stylePresets.ts`, unit tested without an engine or a component; the inspector and the
command palette are both thin UI over it.

## What a preset holds

The 8 fields `DrawElementStylePatch` always had — stroke colour, background colour, fill
style, stroke width, stroke style, roughness, opacity, roundness — plus a font: family,
size, horizontal alignment. Applying a preset reuses the engine's existing
`apply_style`/`engine.applyStyle` path rather than adding a second one. That function
already does exactly what a preset needs: with a selection, it restyles it (and the
labels it carries) as **one step of undo** and sets the _next_ element's style too; with
nothing selected, it only does the latter (`selection_style.rs`'s own doc comment). The
font is laid out again the same way `set_font_size`/`set_font_family`/`set_text_align`
do, reusing that relayout write rather than a second one (`apply_style_font`,
`selection_style.rs`).

## The default is not a preset

**VERIFIED** against the oracle. A new element's fill style is **solid**, the oracle's
`DEFAULT_ELEMENT_PROPS.fillStyle` (`packages/common/src/constants.ts@1118751f:522`), read
into `currentItemFillStyle` (`appState.ts@1118751f:34`) and handed to every new element
(`App.tsx@1118751f:10467`, `newElement.ts@1118751f:94`). It is
`DrawElementStyle::default()` in `scene/element.rs`, with the TS copy of the same seed in
`DEFAULT_ELEMENT_STYLE` (`engine/src/types.ts`) kept in step for the panel's placeholder.

It was hachure here, and **nothing showed it**: a transparent background paints no fill
under any style, and the inspector's Fill style row is not on the panel until a background
exists. So the first colour a person picked turned every shape into that colour _and_ a
diagonal hatch over it, where the oracle paints it flat. A default that only becomes
visible under a later action is a default worth pinning in a test — the shape-only path is
the one that shows it, because the sticky-note, bucket-fill and vectorize paths each force
solid for themselves (`begin_sticky` in `pointer.rs`, `normalize_sticky_style` in
`selection_style.rs`, `bucket_fill_style`/`paint_fill_style` in `engine/bucket.rs` and
`trace_line` in `engine/vectorize.rs`), which is why testing the bucket alone concludes
nothing is wrong.

Stored elements are unaffected: `fill_style` has no serde default, so a board written
before this change reloads byte for byte as it was saved. Only newly minted elements differ.

## Built-ins

Five, distinct enough to tell apart at a glance — not a port, the oracle ships no
equivalent at `@1118751f` — each with its own font too:

| Preset     | Look                                                  | Font       |
| ---------- | ----------------------------------------------------- | ---------- |
| Sketch     | Hachure fill, visible roughness — the sketchbook look | Virgil     |
| Clean      | Solid fill, no roughness, thin stroke                 | Helvetica  |
| Blueprint  | Blue stroke, transparent fill, sharp corners          | Cascadia   |
| Highlight  | Orange stroke, solid warm fill                        | Lilita One |
| Muted note | Grey, dashed, slightly translucent                    | Nunito     |

## User presets

"+" in the panel's Presets row saves the current selection's style — or, with nothing
selected, the next element's — as a new preset, named `Preset N` until renamed. The 8
style fields come from the first selected element (`engine.getSelectedElements()[0]`) or
`engine.getNextStyle()`; the font comes from `selectionStyle()` instead
(`DrawSurface.svelte`'s `summary`), the same read the panel's own font controls use for
both cases, `null` on a mixed-font selection rather than picking one arbitrarily. Each
user preset gets a rename (✎) and delete (✕) control the built-ins don't; built-ins can
be applied but not edited or removed.

Persisted per viewer in `localStorage` (`drawnosaurus:style-presets`) behind try/catch —
`readUserPresets`/`persistUserPresets`, the same pattern as every other preference here
(`theme.ts`). Malformed or blocked storage reads back as no user presets, never a crash.

## Where it shows up

- The inspector's **Presets** row (`DrawInspector.svelte`), a horizontal strip of chips —
  built-ins first, then the viewer's own, matching `stylePresets.ts`'s own `allPresets`
  order.
- The command palette (`docs/reference/palette.md`), one command per preset, under "Style
  presets".

## Known limits

- Saving from a multi-selection captures only one element's style
  (`engine.getSelectedElements()[0]`) — unlike `copy_styles`' own "first in stacking
  order" rule (Ctrl/Cmd+Alt+C), `selected_ids` is a `HashSet`, so _which_ element is
  arbitrary for a multi-selection. Save with one element selected for a predictable
  result.
