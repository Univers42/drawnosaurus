import { describe, expect, it } from "vitest";
import { autosaveLabel } from "./status.ts";

describe("autosaveLabel", () => {
  it("names every saver state", () => {
    expect(autosaveLabel("idle")).toBe("Saved");
    expect(autosaveLabel("pending")).toBe("Unsaved changes");
    expect(autosaveLabel("saving")).toBe("Saving…");
    expect(autosaveLabel("error")).toBe("Save failed — retrying");
  });
});
