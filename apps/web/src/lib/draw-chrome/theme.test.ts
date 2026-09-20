import { describe, expect, it } from "vitest";
import { LIGHT_THEME } from "@osionos/draw-engine/types";
import { themeFromCss } from "./theme.ts";

describe("themeFromCss", () => {
  it("reads the host tokens", () => {
    const style = {
      getPropertyValue: (name: string): string =>
        (
          ({
            "--surface": "  #ffffff",
            "--line": "rgba(17, 17, 17, 0.06)",
            "--accent": "#4c6ef5",
            "--ink": "#1e1e1e",
          }) as Record<string, string>
        )[name] ?? "",
    };

    expect(themeFromCss(style)).toEqual({
      theme: { background: "#ffffff", grid: "rgba(17, 17, 17, 0.06)", accent: "#4c6ef5" },
      ink: "#1e1e1e",
    });
  });

  it("falls back when a token is missing", () => {
    const style = { getPropertyValue: (): string => "  " };
    expect(themeFromCss(style)).toEqual({ theme: LIGHT_THEME, ink: "#1e1e1e" });
  });
});
