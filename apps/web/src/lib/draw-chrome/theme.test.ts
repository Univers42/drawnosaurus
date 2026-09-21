import { describe, expect, it } from "vitest";
import { LIGHT_THEME } from "@osionos/draw-engine/types";
import { persistThemeMode, readThemeMode, themeFromCss } from "./theme.ts";

describe("theme mode persistence", () => {
  const store = (value: string | null) => ({ getItem: () => value });

  it("round-trips the chosen mode", () => {
    const written: Record<string, string> = {};
    persistThemeMode({ setItem: (k, v) => void (written[k] = v) }, "dark");
    expect(readThemeMode({ getItem: (k) => written[k] ?? null })).toBe("dark");
  });

  it("defaults to light for an unset, unknown or absent store", () => {
    expect(readThemeMode(store(null))).toBe("light");
    expect(readThemeMode(store("solarized"))).toBe("light");
    expect(readThemeMode(undefined)).toBe("light");
  });

  it("survives storage that throws — a private window is not a failed toggle", () => {
    const hostile = {
      getItem: (): string => {
        throw new Error("blocked");
      },
      setItem: (): void => {
        throw new Error("blocked");
      },
    };
    expect(readThemeMode(hostile)).toBe("light");
    expect(() => persistThemeMode(hostile, "dark")).not.toThrow();
  });
});

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
