import { describe, expect, it } from "vitest";
import { recoverStripped } from "./recover.ts";

const el = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  type: "embed",
  version: 3,
  versionNonce: 30,
  updated: 1,
  isDeleted: false,
  ...patch,
});

const URL_ = "https://www.youtube.com/embed/abc";

describe("recoverStripped", () => {
  it("gives back what the server stripped from the same edit, re-stamped to be saved", () => {
    const server = [el("video"), el("box", { type: "rectangle" })];
    const draft = [el("video", { embedUrl: URL_ }), el("box", { type: "rectangle" })];

    const { elements, repaired } = recoverStripped(server, draft, 99, () => 7);

    expect(repaired).toEqual([
      el("video", { embedUrl: URL_, version: 4, versionNonce: 7, updated: 99 }),
    ]);
    expect(elements).toEqual([repaired[0], server[1]]);
  });

  it("recovers a frame's name, what frame an element is in, and a picture", () => {
    const server = [el("f", { type: "frame" }), el("n"), el("img", { type: "image" })];
    const draft = [
      el("f", { type: "frame", name: "Sprint" }),
      el("n", { frameId: "f" }),
      el("img", { type: "image", dataUrl: "data:image/png;base64,AA==" }),
    ];
    const { repaired } = recoverStripped(server, draft, 1, () => 1);
    expect(repaired.map((element) => element.id)).toEqual(["f", "n", "img"]);
  });

  it("takes nothing from a draft of another edit, older or newer", () => {
    const server = [el("video")];
    for (const other of [el("video", { version: 2 }), el("video", { versionNonce: 31 })]) {
      const draft = [{ ...other, embedUrl: URL_ }];
      expect(recoverStripped(server, draft, 1, () => 1).repaired).toEqual([]);
    }
  });

  it("changes nothing without a draft, or when the server has it all", () => {
    const server = [el("video", { embedUrl: URL_ })];
    expect(recoverStripped(server, null, 1, () => 1)).toEqual({ elements: server, repaired: [] });
    expect(
      recoverStripped(server, [el("video", { embedUrl: "other" })], 1, () => 1).repaired,
    ).toEqual([]);
  });
});
