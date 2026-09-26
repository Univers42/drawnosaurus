# Style presets

Named bundles of style — pick one and every new shape starts looking like it, or restyle a
selection to match in one step. Pure logic in `apps/web/src/lib/draw-chrome/
stylePresets.ts`, unit tested without an engine or a component; the inspector and the
command palette are both thin UI over it.

## What a preset holds

Exactly the 8 fields `DrawElementStylePatch` already has — stroke colour, background
colour, fill style, stroke width, stroke style, roughness, opacity, roundness — because
applying a preset reuses the engine's existing `apply_style`/`engine.applyStyle` path
rather than adding a second one. That function already does exactly what a preset needs:
with a selection, it restyles it (and the labels it carries) as **one step of undo** and
sets the _next_ element's style too; with nothing selected, it only does the latter
(`selection_style.rs`'s own doc comment). No engine change was needed for this part.

```
ponytail: presets cover the 8 DrawElementStyle fields, not font family/size/text align —
DrawElementStylePatch has no font fields, and giving it one means teaching apply_style to
remeasure wrapped text in the same commit, a real engine change out of scope here.
Upgrade path: add optional fontFamily/fontSize/textAlign to DrawElementStylePatch and
remeasure before its commit.
```

## Built-ins

Five, distinct enough to tell apart at a glance — not a port, the oracle ships no
equivalent at `@1118751f`:

| Preset     | Look                                               |
| ---------- | -------------------------------------------------- |
| Sketch     | Hachure fill, visible roughness — the default feel |
| Clean      | Solid fill, no roughness, thin stroke              |
| Blueprint  | Blue stroke, transparent fill, sharp corners       |
| Highlight  | Orange stroke, solid warm fill                     |
| Muted note | Grey, dashed, slightly translucent                 |

## User presets

"+" in the panel's Presets row saves the current selection's style (or, with nothing
selected, the next element's — `engine.getNextStyle()`) as a new preset, named `Preset N`
until renamed. Each user preset gets a rename (✎) and delete (✕) control the built-ins
don't; built-ins can be applied but not edited or removed.

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

- Font family, size and text align are not part of a preset — see the `ponytail` note
  above.
- Saving from a multi-selection captures only one element's style
  (`engine.getSelectedElements()[0]`) — unlike `copy_styles`' own "first in stacking
  order" rule (Ctrl/Cmd+Alt+C), `selected_ids` is a `HashSet`, so _which_ element is
  arbitrary for a multi-selection. Save with one element selected for a predictable
  result.
