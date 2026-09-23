import { describe, expect, it } from "vitest";
import {
  ALLOWED_EMBED_HOSTS,
  EMBED_ALLOW,
  EMBED_REFERRER_POLICY,
  frameInnerStyle,
  frameSrc,
  frameStyle,
  isClick,
  isFrameCentre,
  parseEmbedFrames,
  playMessage,
  sandboxFor,
  viewportScale,
  type EmbedFrame,
} from "./embed.ts";

const frame = (over: Partial<EmbedFrame> = {}): EmbedFrame => ({
  id: "e1",
  url: "https://www.youtube.com/embed/abc",
  kind: "video",
  allowSameOrigin: false,
  x: 10,
  y: 20,
  width: 560,
  height: 315,
  angle: 0,
  scale: 1,
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

describe("what a frame is loaded with", () => {
  it("sends this site's origin as the referrer, and no more", () => {
    // `no-referrer` made YouTube refuse every video: "Error 153 — video player
    // configuration error". It needs to know which site is embedding it.
    expect(EMBED_REFERRER_POLICY).not.toBe("no-referrer");
    expect(EMBED_REFERRER_POLICY).toBe("strict-origin-when-cross-origin");
  });

  it("lets a player play and go full screen", () => {
    expect(EMBED_ALLOW).toContain("autoplay");
    expect(EMBED_ALLOW).toContain("fullscreen");
    expect(EMBED_ALLOW).toContain("encrypted-media");
  });

  it("lets a link out of the frame open as an ordinary tab", () => {
    expect(sandboxFor({ allowSameOrigin: true })).toContain("allow-popups-to-escape-sandbox");
  });

  it("tells Twitch which site is embedding it, and nobody else", () => {
    // Twitch refuses to play without `parent`, and only the host knows its own name.
    const twitch = frameSrc({ url: "https://player.twitch.tv/?channel=monstercat" }, "board.test");
    expect(new URL(twitch).searchParams.get("parent")).toBe("board.test");
    const clip = frameSrc({ url: "https://clips.twitch.tv/embed?clip=Abc" }, "board.test");
    expect(new URL(clip).searchParams.get("parent")).toBe("board.test");
    const youtube = "https://www.youtube.com/embed/abc?enablejsapi=1";
    expect(frameSrc({ url: youtube }, "board.test")).toBe(youtube);
  });
});

describe("placing a frame", () => {
  it("puts the box where the engine said, at the embed's size on the board", () => {
    // The engine owns the camera: the box starts at its screen position and is the
    // embed's size on the board, scaled by the zoom it reports.
    const style = frameStyle(frame({ x: 10, y: 20, width: 280, height: 157.5, scale: 0.5 }));
    expect(style).toContain("left:10px");
    expect(style).toContain("top:20px");
    expect(style).toContain("width:560px");
    expect(style).toContain("height:315px");
    expect(style).toContain("transform-origin:0 0");
    expect(style).toContain("transform:scale(0.5)");
  });

  it("turns about the centre, and only when there is an angle", () => {
    expect(frameStyle(frame())).not.toContain("rotate");
    const turned = frameStyle(frame({ angle: 0.5 }));
    expect(turned).toContain(
      "translate(280px, 157.5px) rotate(0.5rad) translate(-280px, -157.5px)",
    );
  });

  it("lays a page out at its size on the board, whatever the zoom", () => {
    // So it zooms with the drawing instead of reflowing into a box that shrinks.
    const page = frame({ kind: "generic", width: 84, height: 126, scale: 0.15 });
    expect(viewportScale(page)).toBe(1);
    expect(frameInnerStyle(page)).toContain("width:560px");
  });

  it("keeps a player usable when zoomed out, and sharp when zoomed in", () => {
    // Laid out at 560px and shown at 15%, a player is too small to use; at 300% it is a
    // small stream stretched across the screen. Its viewport follows the zoom, within
    // bounds, and is scaled back by the same amount.
    expect(viewportScale(frame({ scale: 0.15 }))).toBe(0.75);
    expect(viewportScale(frame({ scale: 2 }))).toBe(2);
    expect(viewportScale(frame({ scale: 9 }))).toBe(4);
    const zoomed = frameInnerStyle(frame({ width: 1120, height: 630, scale: 2 }));
    expect(zoomed).toContain("width:1120px");
    expect(zoomed).toContain("transform:scale(0.5)");
  });
});

describe("handing the pointer to the page", () => {
  it("only from the middle third, so the rest still grabs the embed", () => {
    const f = frame({ x: 0, y: 0, width: 600, height: 300 });
    expect(isFrameCentre(f, 300, 150)).toBe(true);
    expect(isFrameCentre(f, 390, 190)).toBe(true);
    expect(isFrameCentre(f, 420, 150)).toBe(false);
    expect(isFrameCentre(f, 300, 40)).toBe(false);
  });

  it("measures the middle of a turned frame along its own axes", () => {
    // Turned a quarter: the long side now runs down the screen.
    const f = frame({ x: 0, y: 0, width: 600, height: 300, angle: Math.PI / 2 });
    expect(isFrameCentre(f, 300, 150 + 90)).toBe(true);
    expect(isFrameCentre(f, 300 + 90, 150)).toBe(false);
  });

  it("on a click, not at the end of a drag", () => {
    const down = { x: 100, y: 100, at: 0 };
    expect(isClick(down, { x: 102, y: 101, at: 120 })).toBe(true);
    expect(isClick(down, { x: 140, y: 100, at: 120 })).toBe(false);
    expect(isClick(down, { x: 100, y: 100, at: 900 })).toBe(false);
  });

  it("starts the players that take a command, and leaves the rest alone", () => {
    expect(playMessage("https://www.youtube.com/embed/abc?enablejsapi=1")).toContain("playVideo");
    expect(playMessage("https://player.vimeo.com/video/1?api=1")).toContain("play");
    expect(playMessage("https://open.spotify.com/embed/track/abc")).toBeNull();
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
