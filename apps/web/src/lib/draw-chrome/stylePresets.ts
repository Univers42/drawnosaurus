/**
 * Named style bundles — save the current selection's look, apply it elsewhere, one undo
 * step either way. Pure and DOM-free like `theme.ts`'s preferences, so the storage
 * round-trip and the CRUD are unit tested without an engine or a component.
 *
 * A preset covers exactly what `DrawEngine::apply_style`/`engine.applyStyle` already
 * take — `DrawElementStylePatch`'s 8 fields (stroke/background colour, fill style, stroke
 * width and style, roughness, opacity, roundness) — reusing that one existing engine path
 * rather than adding another. Font family, size and text align are not part of a preset:
 * `DrawElementStylePatch` has no font fields, and giving it one means teaching
 * `apply_style` to remeasure wrapped text in the same commit, a real engine change out of
 * scope here.
 * `ponytail: presets cover the 8 DrawElementStyle fields only, not font family/size/text
 * align — upgrade path: add optional font fields to DrawElementStylePatch and remeasure in
 * apply_style before its commit.`
 */

import type { DrawElementStyle } from "@osionos/draw-engine/types";

export interface StylePreset {
  id: string;
  name: string;
  style: Partial<DrawElementStyle>;
}

const STYLE_FIELDS = [
  "strokeColor",
  "backgroundColor",
  "fillStyle",
  "strokeWidth",
  "strokeStyle",
  "roughness",
  "opacity",
  "roundness",
] as const satisfies readonly (keyof DrawElementStyle)[];

/** The 8 `DrawElementStyle` fields present on `source`, dropping everything else — an
 *  element's other properties (id, geometry, text, …) included. */
export function pickStyleFields(source: Partial<DrawElementStyle>): Partial<DrawElementStyle> {
  const result: Partial<DrawElementStyle> = {};
  for (const field of STYLE_FIELDS) {
    if (source[field] !== undefined) {
      // Each field is copied at its own type; the loop itself is untyped over the union.
      (result as Record<string, unknown>)[field] = source[field];
    }
  }
  return result;
}

/**
 * Five built-in looks, distinct enough to tell apart at a glance. Not a port — the oracle
 * ships no equivalent presets at `@1118751f` — this project's own picks.
 */
export const BUILTIN_PRESETS: readonly StylePreset[] = [
  {
    id: "sketch",
    name: "Sketch",
    style: {
      strokeColor: "#1e1e1e",
      backgroundColor: "#ffec99",
      fillStyle: "hachure",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1.5,
      opacity: 100,
      roundness: 8,
    },
  },
  {
    id: "clean",
    name: "Clean",
    style: {
      strokeColor: "#1e1e1e",
      backgroundColor: "#e7f5ff",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 0,
      opacity: 100,
      roundness: 8,
    },
  },
  {
    id: "blueprint",
    name: "Blueprint",
    style: {
      strokeColor: "#1971c2",
      backgroundColor: "transparent",
      fillStyle: "hachure",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 0,
      opacity: 100,
      roundness: 0,
    },
  },
  {
    id: "highlight",
    name: "Highlight",
    style: {
      strokeColor: "#e8590c",
      backgroundColor: "#ffd8a8",
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      roundness: 8,
    },
  },
  {
    id: "muted-note",
    name: "Muted note",
    style: {
      strokeColor: "#495057",
      backgroundColor: "#f1f3f5",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "dashed",
      roughness: 0.5,
      opacity: 80,
      roundness: 8,
    },
  },
];

/** The built-ins, then the user's own — the order both the inspector and the palette list them in. */
export function allPresets(userPresets: readonly StylePreset[]): StylePreset[] {
  return [...BUILTIN_PRESETS, ...userPresets];
}

function newPresetId(): string {
  return `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function saveUserPreset(
  presets: readonly StylePreset[],
  name: string,
  style: Partial<DrawElementStyle>,
): StylePreset[] {
  return [...presets, { id: newPresetId(), name, style }];
}

export function renameUserPreset(
  presets: readonly StylePreset[],
  id: string,
  name: string,
): StylePreset[] {
  return presets.map((preset) => (preset.id === id ? { ...preset, name } : preset));
}

export function deleteUserPreset(presets: readonly StylePreset[], id: string): StylePreset[] {
  return presets.filter((preset) => preset.id !== id);
}

const STORAGE_KEY = "drawnosaurus:style-presets";

function isStylePreset(value: unknown): value is StylePreset {
  if (typeof value !== "object" || value === null) return false;
  const preset = value as Partial<StylePreset>;
  return (
    typeof preset.id === "string" &&
    typeof preset.name === "string" &&
    typeof preset.style === "object" &&
    preset.style !== null
  );
}

/** The viewer's own saved presets, `[]` for anything unset, malformed or refused — a
 *  private window's storage is a missing preset list, not a crash. */
export function readUserPresets(storage?: Pick<Storage, "getItem">): StylePreset[] {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isStylePreset) : [];
  } catch {
    return [];
  }
}

export function persistUserPresets(
  storage: Pick<Storage, "setItem">,
  presets: readonly StylePreset[],
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Best effort, same as every other preference here — a blocked store is not a failed apply.
  }
}
