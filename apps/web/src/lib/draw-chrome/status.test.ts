import { describe, expect, it } from "vitest";
import { autosaveIsTrouble, autosaveLabel, liveLabel } from "./status.ts";

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

describe("autosaveIsTrouble", () => {
  it("flags every state in which the board is not saved and will not be by waiting", () => {
    expect(["error", "too-large", "refused"].every((s) => autosaveIsTrouble(s as never))).toBe(
      true,
    );
    expect(["idle", "pending", "saving"].some((s) => autosaveIsTrouble(s as never))).toBe(false);
  });
});

describe("liveLabel", () => {
  const fresh = { everConnected: false, everFailed: false };
  const lost = { everConnected: true, everFailed: true };
  const neverUp = { everConnected: false, everFailed: true };

  it("says nothing while connected", () => {
    expect(liveLabel("connected", lost)).toBeNull();
    expect(liveLabel("connected", fresh)).toBeNull();
  });

  it("says nothing during the first connection", () => {
    expect(liveLabel("connecting", fresh)).toBeNull();
  });

  it("says so when a connection that worked is lost, while it reconnects", () => {
    expect(liveLabel("disconnected", lost)).toBe("Connection lost — reconnecting…");
    expect(liveLabel("connecting", lost)).toBe("Connection lost — reconnecting…");
  });

  it("says so when the first connection failed outright, through every retry", () => {
    // The ERR_CONNECTION_REFUSED case: the API is not there at all.
    expect(liveLabel("disconnected", neverUp)).toBe("Live collaboration offline — retrying");
    expect(liveLabel("connecting", neverUp)).toBe("Live collaboration offline — retrying");
  });
});
