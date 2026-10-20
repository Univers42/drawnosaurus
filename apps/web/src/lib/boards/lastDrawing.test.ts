import { describe, expect, it } from "vitest";
import {
  LAST_DRAWING_KEY,
  forgetLastDrawing,
  recallLastDrawing,
  rememberLastDrawing,
} from "./lastDrawing.ts";

/** A `Storage` over a record, as much of one as the module uses. */
function memory(entries: Record<string, string> = {}) {
  const held = { ...entries };
  return {
    held,
    getItem: (key: string) => held[key] ?? null,
    setItem: (key: string, value: string) => void (held[key] = value),
    removeItem: (key: string) => void delete held[key],
  };
}

describe("the drawing last open in this browser", () => {
  it("is the one last remembered", () => {
    const storage = memory();
    expect(recallLastDrawing(storage)).toBeNull();

    rememberLastDrawing(storage, "first1");
    rememberLastDrawing(storage, "second1");

    expect(recallLastDrawing(storage)).toBe("second1");
    expect(storage.held).toEqual({ [LAST_DRAWING_KEY]: "second1" });
  });

  it("is forgotten when it is deleted, and only then", () => {
    const storage = memory();
    rememberLastDrawing(storage, "kept01");

    forgetLastDrawing(storage, "other1");
    expect(recallLastDrawing(storage)).toBe("kept01");

    forgetLastDrawing(storage, "kept01");
    expect(recallLastDrawing(storage)).toBeNull();
  });

  it("is none when what is stored is not a slug", () => {
    // `/` goes to the address it makes of it, so a hand-edited value must not steer it.
    expect(recallLastDrawing(memory({ [LAST_DRAWING_KEY]: "../gallery" }))).toBeNull();
    expect(recallLastDrawing(memory({ [LAST_DRAWING_KEY]: "" }))).toBeNull();
  });

  it("survives storage that is missing or throws: a new drawing is opened instead", () => {
    const hostile = {
      getItem: (): string => {
        throw new Error("blocked");
      },
      setItem: (): void => {
        throw new Error("blocked");
      },
      removeItem: (): void => {
        throw new Error("blocked");
      },
    };

    expect(recallLastDrawing(hostile)).toBeNull();
    expect(() => rememberLastDrawing(hostile, "mine1")).not.toThrow();
    expect(() => forgetLastDrawing(hostile, "mine1")).not.toThrow();
    expect(recallLastDrawing(undefined)).toBeNull();
    expect(() => rememberLastDrawing(undefined, "mine1")).not.toThrow();
  });
});
