import { LIGHT_THEME, type DrawTheme } from "@osionos/draw-engine/types";

export interface CssVars {
  getPropertyValue(name: string): string;
}

export interface DrawChromeTheme {
  theme: DrawTheme;
  ink: string;
}

/** What the canvas is actually painted as. Never "system" — that has been resolved. */
export type ThemeMode = "light" | "dark";

/**
 * What the user picked, which is not the same thing.
 *
 * "system" is a standing instruction to follow the OS, so it has to survive as itself:
 * collapsing it to whichever mode was current at the time is how a preference silently
 * stops following anything.
 */
export type ThemePreference = ThemeMode | "system";

const THEME_STORAGE_KEY = "drawnosaurus:theme";
const CANVAS_BG_STORAGE_KEY = "drawnosaurus:canvasBackground";

/**
 * The chosen preference, shared by the gallery header and the canvas editor.
 *
 * Both surfaces drive the same `dark` class on <html>, but each used to hold its own
 * unpersisted flag — so a full page load always came back light, and going from a
 * dark gallery into a board produced a white canvas under a dark chrome. One stored
 * value is what keeps them agreeing.
 *
 * Storage is passed in rather than reached for: it is undefined during SSR, and the
 * accessor itself throws in a private window or with site data blocked, neither of
 * which is a reason to fail a theme toggle.
 */
export function readThemePreference(
  storage?: Pick<Storage, "getItem"> | undefined,
): ThemePreference {
  try {
    const stored = storage?.getItem(THEME_STORAGE_KEY);
    return stored === "dark" || stored === "system" ? stored : "light";
  } catch {
    return "light";
  }
}

export function persistThemePreference(
  storage: Pick<Storage, "setItem"> | undefined,
  preference: ThemePreference,
): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Not persisting is survivable; the current page still honours the choice.
  }
}

/** What to actually paint, given the preference and what the OS currently reports. */
export function resolveThemeMode(preference: ThemePreference, prefersDark: boolean): ThemeMode {
  if (preference === "system") {
    return prefersDark ? "dark" : "light";
  }
  return preference;
}

/**
 * The canvas paper colour, when the user has chosen one.
 *
 * Kept apart from the theme: it is a property of the drawing surface, not of the
 * chrome, and it has to survive a light/dark switch rather than being overwritten by
 * whatever `--surface` resolves to.
 */
export function readCanvasBackground(
  storage?: Pick<Storage, "getItem"> | undefined,
): string | null {
  try {
    return storage?.getItem(CANVAS_BG_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function persistCanvasBackground(
  storage: Pick<Storage, "setItem" | "removeItem"> | undefined,
  color: string | null,
): void {
  try {
    if (color === null) storage?.removeItem(CANVAS_BG_STORAGE_KEY);
    else storage?.setItem(CANVAS_BG_STORAGE_KEY, color);
  } catch {
    // As above: a colour that does not persist is better than a failed click.
  }
}

/**
 * Resolve engine chrome from the host tokens. The engine stays token-agnostic.
 *
 * `canvasBackground` overrides the paper colour when the user has picked one, so a
 * chosen background is not thrown away the next time the theme is re-read.
 */
export function themeFromCss(
  style: CssVars,
  fallback: DrawTheme = LIGHT_THEME,
  canvasBackground: string | null = null,
): DrawChromeTheme {
  const read = (name: string, or: string): string => style.getPropertyValue(name).trim() || or;
  return {
    theme: {
      background: canvasBackground ?? read("--surface", fallback.background),
      grid: read("--line", fallback.grid),
      accent: read("--accent", fallback.accent),
      // Not a host token: the binding highlight is Excalidraw's own constant, and
      // matching it is the point. It comes from the fallback theme rather than from
      // the page's palette.
      bindingHighlight: fallback.bindingHighlight,
    },
    ink: read("--ink", "#1e1e1e"),
  };
}
