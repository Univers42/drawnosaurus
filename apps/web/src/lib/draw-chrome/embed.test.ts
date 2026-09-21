import { describe, expect, it } from "vitest";
import { ALLOWED_EMBED_HOSTS, frameStyle, parseEmbedFrames, sandboxFor } from "./embed.ts";

const frame = (over: Partial<Parameters<typeof frameStyle>[0]> = {}) => ({
  id: "e1",
  url: "https://www.youtube.com/embed/abc",
  allowSameOrigin: false,
  x: 10,
  y: 20,
  width: 560,
  height: 315,
  angle: 0,
  ...over,
});

describe("the sandbox an embed runs in", () => {
  it("never grants same-origin by default", () => {
    // `allow-scripts` plus `allow-same-origin` lets a frame remove its own sandbox, so
    // the pair is a decision, not a default.
    const sandbox = sandboxFor({ allowSameOrigin: false });
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-same-origin");
  });

  it("grants it only when the engine said to", () => {
    expect(sandboxFor({ allowSameOrigin: true })).toContain("allow-same-origin");
  });

  it("never grants top-level navigation", () => {
    // A framed page that can navigate the top level can replace the whole board with
    // itself, which is the worst thing an embed can do.
    for (const allowSameOrigin of [true, false]) {
      expect(sandboxFor({ allowSameOrigin })).not.toContain("allow-top-navigation");
    }
  });
});

describe("placing a frame", () => {
  it("uses the screen pixels the engine gave, unchanged", () => {
    // The engine owns the camera. Any arithmetic here is a second opinion that drifts
    // from the rectangle drawn under the frame.
    const style = frameStyle(frame());
    expect(style).toContain("left:10px");
    expect(style).toContain("top:20px");
    expect(style).toContain("width:560px");
    expect(style).toContain("height:315px");
  });

  it("rotates about the centre, and only when there is an angle", () => {
    expect(frameStyle(frame())).not.toContain("transform:rotate");
    const turned = frameStyle(frame({ angle: 0.5 }));
    expect(turned).toContain("rotate(0.5rad)");
    expect(turned).toContain("transform-origin:center center");
  });
});

describe("reading the engine's frame list", () => {
  it("returns the frames", () => {
    expect(parseEmbedFrames(JSON.stringify([frame()]))).toHaveLength(1);
  });

  it("survives anything that is not a frame list", () => {
    for (const json of ["", "null", "{}", "[1,2,3]", "not json"]) {
      expect(parseEmbedFrames(json), json).toEqual([]);
    }
  });

  it("drops a frame with no URL", () => {
    // An `<iframe>` with an empty `src` loads the embedding page itself, so the board
    // would render inside the board.
    expect(parseEmbedFrames(JSON.stringify([frame({ url: "" })]))).toEqual([]);
  });
});

describe("the list shown when a link is refused", () => {
  it("names hosts rather than URLs", () => {
    // It is read aloud in a dialog; a list of full URLs is unreadable there.
    for (const host of ALLOWED_EMBED_HOSTS) {
      expect(host, host).not.toContain("/");
      expect(host, host).not.toContain(":");
    }
  });
});
