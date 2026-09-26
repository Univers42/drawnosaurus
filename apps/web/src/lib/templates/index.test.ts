import { describe, expect, it } from "vitest";
import { osidrawFileSchema } from "@drawnosaurus/contract";
import { TEMPLATES } from "./index.ts";

describe("templates", () => {
  it("offers exactly the five stories, each with a unique id", () => {
    expect(TEMPLATES).toHaveLength(5);
    expect(new Set(TEMPLATES.map((template) => template.id)).size).toBe(TEMPLATES.length);
  });

  for (const template of TEMPLATES) {
    it(`${template.name} is a valid .osidraw file`, () => {
      expect(() => osidrawFileSchema.parse(template.file)).not.toThrow();
      expect(template.file.elements.length).toBeGreaterThan(0);
    });

    it(`${template.name} has a name and a one-line description`, () => {
      expect(template.name.length).toBeGreaterThan(0);
      expect(template.description.length).toBeGreaterThan(0);
      expect(template.description).not.toContain("\n");
    });
  }
});
