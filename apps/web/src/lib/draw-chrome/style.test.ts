import { describe, expect, it } from "vitest";
import { cursorForTool } from "./style.ts";

describe("cursorForTool", () => {
  it("uses a text caret for the text tool", () => {
    expect(cursorForTool("text")).toBe("text");
  });

  it("uses a crosshair for shape and ink tools", () => {
    expect(cursorForTool("rectangle")).toBe("crosshair");
    expect(cursorForTool("freedraw")).toBe("crosshair");
    expect(cursorForTool("eraser")).toBe("crosshair");
  });

  it("uses the default cursor for select and pan", () => {
    expect(cursorForTool("select")).toBe("default");
    expect(cursorForTool("hand")).toBe("default");
  });
});
