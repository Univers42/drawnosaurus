import { describe, expect, it } from "vitest";
import {
  BUILTIN_PRESETS,
  allPresets,
  deleteUserPreset,
  persistUserPresets,
  pickStyleFields,
  readUserPresets,
  renameUserPreset,
  saveUserPreset,
  type StylePreset,
} from "./stylePresets.ts";

describe("BUILTIN_PRESETS", () => {
  it("ships between 4 and 6 built-ins", () => {
    expect(BUILTIN_PRESETS.length).toBeGreaterThanOrEqual(4);
    expect(BUILTIN_PRESETS.length).toBeLessThanOrEqual(6);
  });

  it("gives every built-in a unique id and at least a stroke colour", () => {
    const ids = BUILTIN_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of BUILTIN_PRESETS) {
      expect(preset.style.strokeColor, preset.id).toBeTruthy();
    }
  });

  it("gives every built-in a distinct font", () => {
    const families = BUILTIN_PRESETS.map((p) => p.style.fontFamily);
    for (const family of families) {
      expect(family, "every built-in carries a font").toBeDefined();
    }
    expect(new Set(families).size).toBe(families.length);
  });
});

describe("pickStyleFields", () => {
  it("keeps only the known StylePatch fields, dropping everything else", () => {
    const source = {
      id: "el-1",
      type: "rectangle",
      strokeColor: "#123456",
      backgroundColor: "#abcdef",
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      roundness: 8,
      fontFamily: 5,
      fontSize: 20,
      textAlign: "center",
      x: 0,
      y: 0,
    } as unknown as Parameters<typeof pickStyleFields>[0];

    expect(pickStyleFields(source)).toEqual({
      strokeColor: "#123456",
      backgroundColor: "#abcdef",
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      roundness: 8,
      fontFamily: 5,
      fontSize: 20,
      textAlign: "center",
    });
  });

  it("picks up a font with no other style field set", () => {
    expect(pickStyleFields({ fontFamily: 7 })).toEqual({ fontFamily: 7 });
  });

  it("omits a field the source does not have, rather than writing undefined", () => {
    const result = pickStyleFields({ strokeColor: "#000" });
    expect(result).toEqual({ strokeColor: "#000" });
    expect("backgroundColor" in result).toBe(false);
  });
});

describe("saveUserPreset / renameUserPreset / deleteUserPreset", () => {
  it("appends a new preset with a fresh id", () => {
    const before: StylePreset[] = [];
    const after = saveUserPreset(before, "My look", { strokeColor: "#f00" });
    expect(after).toHaveLength(1);
    expect(after[0]?.name).toBe("My look");
    expect(after[0]?.style).toEqual({ strokeColor: "#f00" });
    expect(after[0]?.id).toBeTruthy();
  });

  it("never mutates the array it was given", () => {
    const before: StylePreset[] = [];
    saveUserPreset(before, "X", {});
    expect(before).toHaveLength(0);
  });

  it("renames the matching preset only", () => {
    const presets: StylePreset[] = [
      { id: "a", name: "A", style: {} },
      { id: "b", name: "B", style: {} },
    ];
    const renamed = renameUserPreset(presets, "a", "A2");
    expect(renamed.map((p) => p.name)).toEqual(["A2", "B"]);
  });

  it("deletes the matching preset only", () => {
    const presets: StylePreset[] = [
      { id: "a", name: "A", style: {} },
      { id: "b", name: "B", style: {} },
    ];
    expect(deleteUserPreset(presets, "a").map((p) => p.id)).toEqual(["b"]);
  });
});

describe("allPresets", () => {
  it("lists the built-ins before the user's own", () => {
    const user: StylePreset[] = [{ id: "u1", name: "Mine", style: {} }];
    const combined = allPresets(user);
    expect(combined.slice(0, BUILTIN_PRESETS.length)).toEqual(BUILTIN_PRESETS);
    expect(combined.at(-1)).toEqual(user[0]);
  });
});

describe("user preset persistence", () => {
  const memory = () => {
    const store = new Map<string, string>();
    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
  };

  it("round-trips through storage", () => {
    const storage = memory();
    const presets: StylePreset[] = [{ id: "a", name: "A", style: { strokeColor: "#111" } }];
    persistUserPresets(storage, presets);
    expect(readUserPresets(storage)).toEqual(presets);
  });

  it("is empty for unset, malformed or absent storage", () => {
    expect(readUserPresets(undefined)).toEqual([]);
    expect(readUserPresets(memory())).toEqual([]);
    const garbage = memory();
    garbage.setItem("drawnosaurus:style-presets", "not json");
    expect(readUserPresets(garbage)).toEqual([]);
    const wrongShape = memory();
    wrongShape.setItem("drawnosaurus:style-presets", JSON.stringify([{ oops: true }]));
    expect(readUserPresets(wrongShape)).toEqual([]);
  });

  it("survives storage that throws", () => {
    const hostile = {
      getItem: (): string => {
        throw new Error("blocked");
      },
      setItem: (): void => {
        throw new Error("blocked");
      },
    };
    expect(readUserPresets(hostile)).toEqual([]);
    expect(() => persistUserPresets(hostile, [])).not.toThrow();
  });
});
