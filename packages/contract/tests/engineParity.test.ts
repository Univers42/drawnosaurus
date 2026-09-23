import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { drawElementSchema } from "../src/element.ts";
import { element } from "./factory.ts";

/**
 * Every field the engine writes has to be in the schema, or the server strips it.
 *
 * Unknown keys are stripped rather than refused (see `element.ts`), which keeps a newer
 * engine writing to an older API — and makes a missing field silent. Three went that way:
 * `embedUrl`, `frameId` and `name`. Every video on a board came back from the server as
 * an empty box, and every frame empty and nameless, with nothing failing anywhere.
 *
 * So this reads the engine's element as its source declares it and holds the schema to
 * it. The contract cannot import the engine — it is Rust compiled to WASM — but it can
 * read what the engine says it serialises.
 */

const ENGINE_ELEMENT = new URL(
  "../../../engine/crates/draw-engine/src/scene/element.rs",
  import.meta.url,
);

const camel = (snake: string): string =>
  snake.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

/** The keys a serialised `DrawElement` can carry, from its struct declaration. */
function engineKeys(source: string): string[] {
  const start = source.indexOf("pub struct DrawElement {");
  if (start < 0) throw new Error("no `pub struct DrawElement` in the engine's element.rs");
  const body = source.slice(start, source.indexOf("\n}\n", start));
  const keys: string[] = [];
  let attributes = "";
  for (const line of body.split("\n").slice(1)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#[")) {
      attributes += trimmed;
      continue;
    }
    const field = /^pub\s+([a-z_][a-z0-9_]*)\s*:/.exec(trimmed);
    if (!field) continue;
    const renamed = /rename\s*=\s*"([^"]+)"/.exec(attributes);
    // Read and never written: the legacy `groupId` spelling.
    const readOnly = /skip_serializing(?!_if)/.test(attributes);
    if (!readOnly) keys.push(renamed?.[1] ?? camel(field[1]!));
    attributes = "";
  }
  return keys;
}

describe("the element schema against the engine's element", () => {
  const keys = engineKeys(readFileSync(ENGINE_ELEMENT, "utf8"));

  it("finds the engine's fields at all", () => {
    // A parse that found nothing would pass the test below vacuously.
    expect(keys).toEqual(expect.arrayContaining(["id", "type", "x", "versionNonce", "isDeleted"]));
    expect(keys.length).toBeGreaterThan(30);
  });

  it("has every field the engine writes, so none is stripped on the way in", () => {
    const missing = keys.filter((key) => !(key in drawElementSchema.shape));
    expect(missing, "fields the server would silently drop").toEqual([]);
  });

  it("keeps an embed's page, a frame's name and what is inside a frame", () => {
    const embed = drawElementSchema.parse(
      element({ type: "embed", embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ" }),
    );
    expect(embed.embedUrl).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");

    const frame = drawElementSchema.parse(element({ type: "frame", name: "Sprint 12" }));
    expect(frame.name).toBe("Sprint 12");

    const inside = drawElementSchema.parse(element({ frameId: "frame-1" }));
    expect(inside.frameId).toBe("frame-1");
  });

  it("bounds an embed's address", () => {
    const long = `https://example.com/${"a".repeat(5000)}`;
    expect(drawElementSchema.safeParse(element({ type: "embed", embedUrl: long })).success).toBe(
      false,
    );
  });
});
