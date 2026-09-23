import { describe, expect, it } from "vitest";
import { autosaveLabel } from "./status.ts";

describe("autosaveLabel", () => {
  it("names every saver state", () => {
    expect(autosaveLabel("idle")).toBe("Saved");
    expect(autosaveLabel("pending")).toBe("Unsaved changes");
    expect(autosaveLabel("saving")).toBe("Saving…");
    expect(autosaveLabel("error")).toBe("Save failed — retrying");
  });

  it("says when a change will not be saved by retrying, and why", () => {
    // Never "Saved": a board refused for its size used to read as saved in the header.
    expect(autosaveLabel("too-large")).toBe("Not saved — board over 16 MB");
    expect(autosaveLabel("refused")).toBe("Not saved — refused by the server");
  });
});
