import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { osidrawFileSchema } from "@drawnosaurus/contract";
import { TEMPLATES } from "./index.ts";

const staticDir = fileURLToPath(new URL("../../../static/templates/", import.meta.url));

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

    it(`${template.name} has a preview PNG under static/templates/`, () => {
      const path = `${staticDir}${template.id}.png`;
      expect(existsSync(path), path).toBe(true);
      expect(statSync(path).size).toBeGreaterThan(0);
    });
  }
});
