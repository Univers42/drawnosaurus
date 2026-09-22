import { describe, expect, it } from "vitest";
import type { DrawNotice } from "@osionos/draw-engine/types";
import { NOTICE_TEXT } from "./notices.ts";

/**
 * Every code the motor can emit has words.
 *
 * The bucket used to discard its failures entirely: a click that found no region did
 * nothing — no element, no cursor change, no message — which for anyone who does not
 * already know a region must be enclosed by *visible* strokes is indistinguishable from
 * a broken tool.
 */
describe("notice text", () => {
  const CODES: DrawNotice[] = ["fill-region-not-closed", "fill-region-too-complex"];

  it("says something for every code", () => {
    for (const code of CODES) {
      expect(NOTICE_TEXT[code], code).toBeTruthy();
    }
  });

  it("has no code without words and no words without a code", () => {
    // The `Record<DrawNotice, string>` type catches a missing entry at compile time;
    // this catches a stale one left behind after a code is removed, which the type
    // cannot see.
    expect(Object.keys(NOTICE_TEXT).sort()).toEqual([...CODES].sort());
  });

  it("tells the person what to do about it, not what the algorithm did", () => {
    // "open_region", "too_small" and "invalid_polygon" are three facts about the
    // arrangement and one fact about the board, and it is the latter that is useful.
    expect(NOTICE_TEXT["fill-region-not-closed"]).toBe(
      "Couldn't find an enclosed region to fill here.",
    );
    expect(NOTICE_TEXT["fill-region-too-complex"]).toBe("This region is too complex to fill.");
  });
});
