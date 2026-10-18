import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SUPPORTED_OSIDRAW_VERSION, replaceBoardSchema } from "../src/index.ts";

/**
 * A scene saved by osionos's retired Draw block must open as a whiteboard: the fixture is
 * one element of each type the old editor drew, and the contract must keep all of them.
 * Reads the file rather than importing it so a missing fixture fails loudly.
 */
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/osionos-legacy-draw.osidraw.json", import.meta.url), "utf8"),
) as { elements: { id: string; type: string }[] };

describe("an osionos legacy .osidraw scene", () => {
  it("passes replaceBoardSchema with every element kept", () => {
    const parsed = replaceBoardSchema.parse({
      type: "osidraw",
      version: SUPPORTED_OSIDRAW_VERSION,
      elements: fixture.elements,
    });
    expect(fixture.elements.length).toBeGreaterThan(0);
    expect(parsed.elements.map((el) => `${el.id}:${el.type}`)).toEqual(
      fixture.elements.map((el) => `${el.id}:${el.type}`),
    );
  });
});
