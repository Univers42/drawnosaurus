import { describe, expect, it } from "vitest";
import { DEFAULT_GRID, LIGHT_THEME } from "@osionos/draw-engine/types";
import {
  DEFAULT_GRID_PREFERENCE,
  persistObjectsSnapPreference,
  persistThemePreference,
  pickGridMode,
  readObjectsSnapPreference,
  readThemePreference,
  resolveThemeMode,
  themeFromCss,
  toggleObjectsSnap,
} from "./theme.ts";

describe("theme mode persistence", () => {
  const store = (value: string | null) => ({ getItem: () => value });

  it("round-trips the chosen mode", () => {
    const written: Record<string, string> = {};
    persistThemePreference({ setItem: (k, v) => void (written[k] = v) }, "dark");
    expect(readThemePreference({ getItem: (k) => written[k] ?? null })).toBe("dark");
  });

  it("defaults to light for an unset, unknown or absent store", () => {
    expect(readThemePreference(store(null))).toBe("light");
    expect(readThemePreference(store("solarized"))).toBe("light");
    expect(readThemePreference(undefined)).toBe("light");
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
    expect(readThemePreference(hostile)).toBe("light");
    expect(() => persistThemePreference(hostile, "dark")).not.toThrow();
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
      theme: {
        background: "#ffffff",
        grid: "rgba(17, 17, 17, 0.06)",
        accent: "#4c6ef5",
        // Carried from the fallback, not read from the page: it is Excalidraw's
        // constant and matching it exactly is the whole point.
        bindingHighlight: LIGHT_THEME.bindingHighlight,
        bindingMidpoint: LIGHT_THEME.bindingMidpoint,
      },
      ink: "#1e1e1e",
    });
  });

  it("falls back when a token is missing", () => {
    const style = { getPropertyValue: (): string => "  " };
    expect(themeFromCss(style)).toEqual({ theme: LIGHT_THEME, ink: "#1e1e1e" });
  });
});

describe("system theme", () => {
  const store = (value: string | null) => ({ getItem: () => value });

  it("keeps 'system' as itself rather than collapsing it to a mode", () => {
    // Storing the resolved mode instead would make the preference stop following the
    // OS the first time it was read back.
    expect(readThemePreference(store("system"))).toBe("system");
  });

  it("follows the OS only when the preference says to", () => {
    expect(resolveThemeMode("system", true)).toBe("dark");
    expect(resolveThemeMode("system", false)).toBe("light");
    expect(resolveThemeMode("light", true)).toBe("light");
    expect(resolveThemeMode("dark", false)).toBe("dark");
  });
});

describe("canvas background", () => {
  it("overrides the paper colour without touching the rest of the chrome", () => {
    const tokens = {
      getPropertyValue: (name: string) =>
        ({ "--surface": "#ffffff", "--line": "#eee", "--accent": "#6965db", "--ink": "#111" })[
          name
        ] ?? "",
    };
    const plain = themeFromCss(tokens);
    const tinted = themeFromCss(tokens, undefined, "#fffce8");

    expect(plain.theme.background).toBe("#ffffff");
    expect(tinted.theme.background).toBe("#fffce8");
    // Everything else is still resolved from the host tokens.
    expect(tinted.theme.grid).toBe(plain.theme.grid);
    expect(tinted.theme.accent).toBe(plain.theme.accent);
    expect(tinted.ink).toBe(plain.ink);
  });
});

describe("snapping to objects", () => {
  const memory = () => {
    const store = new Map<string, string>();
    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
  };

  it("is off when nothing was stored, as Excalidraw ships it", () => {
    expect(readObjectsSnapPreference(memory())).toBe(false);
    expect(readObjectsSnapPreference(undefined)).toBe(false);
  });

  it("remembers being turned on, and off again", () => {
    const storage = memory();
    persistObjectsSnapPreference(storage, true);
    expect(readObjectsSnapPreference(storage)).toBe(true);
    persistObjectsSnapPreference(storage, false);
    expect(readObjectsSnapPreference(storage)).toBe(false);
  });

  it("reads anything unexpected as off, rather than snapping by surprise", () => {
    const storage = memory();
    storage.setItem("drawnosaurus:objects-snap", "yes");
    expect(readObjectsSnapPreference(storage)).toBe(false);
  });

  it("survives storage that throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readObjectsSnapPreference(throwing)).toBe(false);
    expect(() => persistObjectsSnapPreference(throwing, true)).not.toThrow();
  });
});

describe("snap modes exclude each other", () => {
  const gridOn = { ...DEFAULT_GRID_PREFERENCE, enabled: true };
  const gridOff = { ...DEFAULT_GRID_PREFERENCE, enabled: false };

  it("turning object snapping on hides the grid", () => {
    expect(toggleObjectsSnap({ objectsSnap: false, grid: gridOn })).toEqual({
      objectsSnap: true,
      grid: gridOff,
    });
  });

  it("turning it off leaves the grid alone", () => {
    expect(toggleObjectsSnap({ objectsSnap: true, grid: gridOff }).grid).toEqual(gridOff);
  });

  it("showing the grid turns object snapping off", () => {
    expect(pickGridMode({ objectsSnap: true, grid: gridOff }, { enabled: true })).toEqual({
      objectsSnap: false,
      grid: gridOn,
    });
  });

  it("other grid changes leave object snapping alone", () => {
    const modes = { objectsSnap: true, grid: gridOff };
    expect(pickGridMode(modes, { size: 40 }).objectsSnap).toBe(true);
    expect(pickGridMode(modes, { enabled: false }).objectsSnap).toBe(true);
  });
});

describe("the grid default", () => {
  it("is the engine's own DEFAULT_GRID, not a third copy of the numbers", () => {
    // `DEFAULT_GRID_SIZE`/`DEFAULT_GRID_STEP` live in `render/paint.rs` and are
    // exported to the host once. A separate literal here could offer a size the engine
    // then silently refuses.
    expect(DEFAULT_GRID_PREFERENCE).toEqual(DEFAULT_GRID);
    // …pinned as the numbers themselves, so a change on the engine side cannot pass
    // unnoticed by travelling with the import. House precedent: `inspector.test.ts`'s
    // `mirrors the engine's SIDES_RANGE/RATIO_RANGE`.
    expect(DEFAULT_GRID_PREFERENCE).toEqual({ enabled: false, size: 20, step: 5, snap: true });
  });

  it("is a copy of the engine's grid, never the same object", () => {
    // Aliasing `DEFAULT_GRID` hands out the engine's own default: `readGridPreference`
    // returns it on all three of its early returns and `DrawSurface` puts it straight
    // into a `$state`, so one in-place `grid.size = …` anywhere in the front would
    // rewrite `engine/src/types.ts`'s `DEFAULT_GRID` for every other reader. Nothing
    // does that today; the copy is what keeps it true tomorrow.
    expect(DEFAULT_GRID_PREFERENCE).not.toBe(DEFAULT_GRID);
    try {
      DEFAULT_GRID_PREFERENCE.size = 999;
      expect(DEFAULT_GRID.size).toBe(20);
    } finally {
      DEFAULT_GRID_PREFERENCE.size = 20;
    }
  });
});
