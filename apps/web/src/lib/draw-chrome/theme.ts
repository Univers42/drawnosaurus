import { LIGHT_THEME, type DrawTheme } from "@osionos/draw-engine/types";

export interface CssVars {
  getPropertyValue(name: string): string;
}

export interface DrawChromeTheme {
  theme: DrawTheme;
  ink: string;
}

export type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "drawnosaurus:theme";

/**
 * The chosen mode, shared by the gallery header and the canvas editor.
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
export function readThemeMode(storage?: Pick<Storage, "getItem"> | undefined): ThemeMode {
  try {
    return storage?.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function persistThemeMode(
  storage: Pick<Storage, "setItem"> | undefined,
  mode: ThemeMode,
): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Not persisting is survivable; the current page still honours the toggle.
  }
}

/** Resolve engine chrome from the host tokens. The engine stays token-agnostic. */
export function themeFromCss(style: CssVars, fallback: DrawTheme = LIGHT_THEME): DrawChromeTheme {
  const read = (name: string, or: string): string => style.getPropertyValue(name).trim() || or;
  return {
    theme: {
      background: read("--surface", fallback.background),
      grid: read("--line", fallback.grid),
      accent: read("--accent", fallback.accent),
    },
    ink: read("--ink", "#1e1e1e"),
  };
}
