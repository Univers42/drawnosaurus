/**
 * The colour picker's palette and keyboard, as Excalidraw has them.
 *
 * Transcribed from `packages/common/src/colors.ts` and
 * `packages/excalidraw/components/ColorPicker/{colorPickerUtils,keyboardNavHandlers,ColorInput}.ts(x)`
 * at the SHA pinned in `scripts/oracle-sha.txt` (1118751f). Pure, so the popover in
 * `InspectorColorPicker.svelte` is thin glue and every rule here is unit-tested.
 */

/** `COLOR_PALETTE` (`colors.ts@1118751f:193-212`). */
export const COLOR_PALETTE = {
  transparent: "transparent",
  black: "#1e1e1e",
  white: "#ffffff",
  gray: ["#f8f9fa", "#e9ecef", "#ced4da", "#868e96", "#343a40"],
  red: ["#fff5f5", "#ffc9c9", "#ff8787", "#fa5252", "#e03131"],
  pink: ["#fff0f6", "#fcc2d7", "#f783ac", "#e64980", "#c2255c"],
  grape: ["#f8f0fc", "#eebefa", "#da77f2", "#be4bdb", "#9c36b5"],
  violet: ["#f3f0ff", "#d0bfff", "#9775fa", "#7950f2", "#6741d9"],
  blue: ["#e7f5ff", "#a5d8ff", "#4dabf7", "#228be6", "#1971c2"],
  cyan: ["#e3fafc", "#99e9f2", "#3bc9db", "#15aabf", "#0c8599"],
  teal: ["#e6fcf5", "#96f2d7", "#38d9a9", "#12b886", "#099268"],
  green: ["#ebfbee", "#b2f2bb", "#69db7c", "#40c057", "#2f9e44"],
  yellow: ["#fff9db", "#ffec99", "#ffd43b", "#fab005", "#f08c00"],
  orange: ["#fff4e6", "#ffd8a8", "#ffa94d", "#fd7e14", "#e8590c"],
  bronze: ["#f8f1ee", "#eaddd7", "#d2bab0", "#a18072", "#846358"],
} as const;

export type ColorName = keyof typeof COLOR_PALETTE;
export type PaletteEntry = string | readonly string[];

/**
 * The element palette, in grid order: `DEFAULT_ELEMENT_STROKE_COLOR_PALETTE` and
 * `DEFAULT_ELEMENT_BACKGROUND_COLOR_PALETTE` (`colors.ts@1118751f:299-319`), which are the
 * same fifteen entries. The order is the grid and the hotkeys, row by row.
 */
export const ELEMENT_PALETTE: ReadonlyArray<readonly [ColorName, PaletteEntry]> = [
  ["transparent", COLOR_PALETTE.transparent],
  ["white", COLOR_PALETTE.white],
  ["gray", COLOR_PALETTE.gray],
  ["black", COLOR_PALETTE.black],
  ["bronze", COLOR_PALETTE.bronze],
  ["cyan", COLOR_PALETTE.cyan],
  ["blue", COLOR_PALETTE.blue],
  ["violet", COLOR_PALETTE.violet],
  ["grape", COLOR_PALETTE.grape],
  ["pink", COLOR_PALETTE.pink],
  ["green", COLOR_PALETTE.green],
  ["teal", COLOR_PALETTE.teal],
  ["yellow", COLOR_PALETTE.yellow],
  ["orange", COLOR_PALETTE.orange],
  ["red", COLOR_PALETTE.red],
];

/** `locales/en.json@1118751f` › `colors`. */
export const COLOR_LABELS: Record<ColorName, string> = {
  transparent: "Transparent",
  black: "Black",
  white: "White",
  red: "Red",
  pink: "Pink",
  grape: "Grape",
  violet: "Violet",
  gray: "Gray",
  blue: "Blue",
  cyan: "Cyan",
  teal: "Teal",
  green: "Green",
  yellow: "Yellow",
  orange: "Orange",
  bronze: "Bronze",
};

export const COLORS_PER_ROW = 5;
/** `MAX_CUSTOM_COLORS_USED_IN_CANVAS` (`colors.ts@1118751f:185`). */
export const MAX_CUSTOM_COLORS = 5;
/** Which shade the grid shows before one is chosen (`colors.ts@1118751f:190-191`). */
export const DEFAULT_STROKE_SHADE = 4;
export const DEFAULT_BACKGROUND_SHADE = 1;

/** `colorPickerHotkeyBindings` (`colorPickerUtils.ts@1118751f:40-44`), one per grid cell. */
export const COLOR_HOTKEYS = [
  "q",
  "w",
  "e",
  "r",
  "t",
  "a",
  "s",
  "d",
  "f",
  "g",
  "z",
  "x",
  "c",
  "v",
  "b",
];

export type ColorKind = "stroke" | "background";

export function defaultShade(kind: ColorKind): number {
  return kind === "background" ? DEFAULT_BACKGROUND_SHADE : DEFAULT_STROKE_SHADE;
}

/** The colour a grid cell shows at a shade. */
export function paletteColor(entry: PaletteEntry, shade: number): string {
  return typeof entry === "string" ? entry : (entry[shade] ?? entry[0] ?? "transparent");
}

/** Whether a colour paints nothing — the keyword, or a hex with a zero alpha. */
export const isTransparent = (color: string): boolean => {
  const c = color.trim().toLowerCase();
  if (c === "transparent" || c === "") return true;
  if (c.length === 9 && c.startsWith("#")) return c.slice(7) === "00";
  if (c.length === 5 && c.startsWith("#")) return c.slice(4) === "0";
  return false;
};

/** `getColorNameAndShadeFromColor` (`colorPickerUtils.ts@1118751f:13-38`). */
export function colorNameAndShade(
  color: string | null,
): { name: ColorName; index: number; shade: number | null } | null {
  if (!color) return null;
  for (const [index, [name, entry]] of ELEMENT_PALETTE.entries()) {
    if (typeof entry === "string") {
      if (entry === color) return { name, index, shade: null };
    } else {
      const shade = entry.indexOf(color);
      if (shade > -1) return { name, index, shade };
    }
  }
  return null;
}

/** `isCustomColor` (`colorPickerUtils.ts@1118751f:46-55`). */
export function isCustomColor(color: string): boolean {
  return colorNameAndShade(color) === null;
}

/**
 * `getMostUsedCustomColors` (`colorPickerUtils.ts@1118751f:57-94`): the colours on the
 * board that the palette does not have, most used first, at most five. The engine does
 * the counting (`DrawEngine.colorCounts`); ties keep the board's order, as the oracle's
 * stable sort does.
 */
export function mostUsedCustomColors(counts: readonly (readonly [string, number])[]): string[] {
  return counts
    .filter(([color]) => !isTransparent(color) && isCustomColor(color))
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_CUSTOM_COLORS)
    .map(([color]) => color);
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * `normalizeInputColor` (`colors.ts@1118751f:444-460`): keeps a valid colour as typed,
 * adding the `#` a hex was typed without; `null` for anything else.
 *
 * The oracle asks tinycolor whether a colour is valid; the browser's own
 * `CSS.supports("color", …)` answers the same question without a dependency, and is
 * passed in so this stays testable without a DOM.
 */
export function normalizeInputColor(
  input: string,
  supports: (color: string) => boolean = cssSupportsColor,
): string | null {
  const color = input.trim();
  if (color === "") return null;
  if (isTransparent(color)) return color;
  if (HEX.test(color)) return color.startsWith("#") ? color : `#${color}`;
  return supports(color) ? color : null;
}

function cssSupportsColor(color: string): boolean {
  return typeof CSS !== "undefined" && CSS.supports("color", color);
}

/** `ColorInput`'s messages (`ColorInput.tsx@1118751f:40-58`, `locales/en.json` › `colorPicker`). */
export const INVALID_HEX_LENGTH = "Hex code must be 3, 4, 6, or 8 characters";
export const INVALID_COLOR = "Not a valid color";

/**
 * What typing in the hex field does: the colour to apply, or the error to show. The
 * input is lower-cased first, as the oracle's is.
 */
export function readColorInput(
  input: string,
  supports?: (color: string) => boolean,
): { color: string | null; error: string | null } {
  const value = input.toLowerCase().trim();
  const color = normalizeInputColor(value, supports);
  if (color) return { color, error: null };
  if (value.length === 0) return { color: null, error: null };
  return { color: null, error: /^#?[0-9a-f]+$/.test(value) ? INVALID_HEX_LENGTH : INVALID_COLOR };
}

export type PickerSection = "custom" | "baseColors" | "shades" | "hex";

export interface PickerKeyState {
  section: PickerSection | null;
  color: string | null;
  customColors: readonly string[];
  activeShade: number;
}

export type PickerKeyAction =
  | { kind: "close" }
  | { kind: "eyedropper" }
  | { kind: "pick"; color: string; section: PickerSection | null }
  | { kind: "section"; section: PickerSection; color: string | null }
  | { kind: "inert" };

export interface PickerKey {
  key: string;
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/** `arrowHandler` (`keyboardNavHandlers.ts@1118751f:18-46`): moves within a 5-wide grid. */
export function arrowIndex(
  key: string,
  current: number | null,
  length: number,
): number | undefined {
  const rows = Math.ceil(length / COLORS_PER_ROW);
  const at = current ?? -1;
  switch (key) {
    case "ArrowLeft":
      return at - 1 < 0 ? length - 1 : at - 1;
    case "ArrowRight":
      return (at + 1) % length;
    case "ArrowDown": {
      const next = at + COLORS_PER_ROW;
      return next >= length ? at % COLORS_PER_ROW : next;
    }
    case "ArrowUp": {
      const previous = at - COLORS_PER_ROW;
      const next = previous < 0 ? COLORS_PER_ROW * rows + previous : previous;
      return next >= length ? undefined : next;
    }
    default:
      return undefined;
  }
}

/**
 * `colorPickerKeyNavHandler` (`keyboardNavHandlers.ts@1118751f:138-318`) as a pure
 * function: what a key does in the open picker, or `null` when it is not the picker's.
 *
 * Escape closes; `i` toggles the eyedropper; the grid letters pick at the active shade;
 * Shift+1…5 picks a shade of the current colour; 1…5 picks a most-used custom colour;
 * Tab moves between the sections that exist; the arrows move within one.
 *
 * Holding Alt for the eyedropper is not ported: Alt is the modifier of too many of this
 * editor's own chords to be taken while a picker is open.
 */
export function pickerKeyAction(event: PickerKey, state: PickerKeyState): PickerKeyAction | null {
  if (event.ctrlKey || event.metaKey) return null;
  if (event.key === "Escape") return { kind: "close" };
  if (event.key === "i") return { kind: "eyedropper" };

  const current = colorNameAndShade(state.color);

  if (event.key === "Tab") {
    const sections: PickerSection[] = [];
    if (state.customColors.length) sections.push("custom");
    sections.push("baseColors");
    if (current?.shade != null) sections.push("shades");
    sections.push("hex");
    const at = state.section ? sections.indexOf(state.section) : -1;
    const step = event.shiftKey ? -1 : 1;
    const nextAt =
      at + step > sections.length - 1 ? 0 : at + step < 0 ? sections.length - 1 : at + step;
    const section = sections[nextAt] ?? "baseColors";
    if (section === "custom")
      return { kind: "section", section, color: state.customColors[0] ?? null };
    if (section === "baseColors" && !current) {
      return { kind: "section", section, color: COLOR_PALETTE.black };
    }
    return { kind: "section", section, color: null };
  }

  if (current?.shade != null && event.shiftKey && /^Digit[1-5]$/.test(event.code)) {
    const entry = ELEMENT_PALETTE[current.index]?.[1];
    if (entry)
      return {
        kind: "pick",
        color: paletteColor(entry, Number(event.code.slice(-1)) - 1),
        section: "shades",
      };
  }
  if (/^[1-5]$/.test(event.key)) {
    const custom = state.customColors[Number(event.key) - 1];
    if (custom) return { kind: "pick", color: custom, section: "custom" };
  }
  const hotkey = COLOR_HOTKEYS.indexOf(event.key);
  if (hotkey > -1) {
    const entry = ELEMENT_PALETTE[hotkey]?.[1];
    // A key with no colour behind it is still the picker's, so it cannot fall through
    // to a tool shortcut (`keyboardNavHandlers.ts@1118751f:103-110`).
    if (!entry) return { kind: "inert" };
    return { kind: "pick", color: paletteColor(entry, state.activeShade), section: "baseColors" };
  }

  if (state.section === "shades" && current?.shade != null) {
    const shade = arrowIndex(event.key, current.shade, COLORS_PER_ROW);
    const entry = ELEMENT_PALETTE[current.index]?.[1];
    if (shade !== undefined && entry)
      return { kind: "pick", color: paletteColor(entry, shade), section: "shades" };
  }
  if (state.section === "baseColors" && current) {
    const index = arrowIndex(event.key, current.index, ELEMENT_PALETTE.length);
    const entry = index === undefined ? undefined : ELEMENT_PALETTE[index]?.[1];
    if (entry)
      return { kind: "pick", color: paletteColor(entry, state.activeShade), section: "baseColors" };
  }
  if (state.section === "custom") {
    const at = state.color != null ? state.customColors.indexOf(state.color) : 0;
    const index = arrowIndex(event.key, at, state.customColors.length);
    const color = index === undefined ? undefined : state.customColors[index];
    if (color) return { kind: "pick", color, section: "custom" };
  }
  return null;
}

/** The section a picker opens on (`Picker.tsx@1118751f:81-100`). */
export function initialSection(
  color: string | null,
  customColors: readonly string[],
): PickerSection | null {
  if (color && isCustomColor(color)) return customColors.includes(color) ? "custom" : null;
  return colorNameAndShade(color)?.shade != null ? "shades" : "baseColors";
}
