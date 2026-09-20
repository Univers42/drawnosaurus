import { LIGHT_THEME, type DrawTheme } from "@osionos/draw-engine/types";

export interface CssVars {
  getPropertyValue(name: string): string;
}

export interface DrawChromeTheme {
  theme: DrawTheme;
  ink: string;
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
