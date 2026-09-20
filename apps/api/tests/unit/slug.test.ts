import { describe, expect, it } from "vitest";
import { slugSchema } from "@drawnosaurus/contract";
import { mintSlug } from "../../src/boards/slug.ts";

describe("mintSlug", () => {
  it("always satisfies the public slug schema", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(slugSchema.safeParse(mintSlug()).success).toBe(true);
    }
  });

  it("does not repeat across a realistic burst", () => {
    const slugs = new Set(Array.from({ length: 2000 }, mintSlug));
    expect(slugs.size).toBe(2000);
  });

  it("uses the whole alphabet rather than biasing early letters", () => {
    // Rejection sampling is the reason this holds; a plain byte modulo would
    // over-represent the first few characters.
    const seen = new Set([...Array.from({ length: 500 }, mintSlug).join("")]);
    expect(seen.size).toBeGreaterThan(30);
  });
});
