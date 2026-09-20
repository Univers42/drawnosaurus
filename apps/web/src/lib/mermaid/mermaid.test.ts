import { describe, expect, it } from "vitest";
import { drawElementSchema } from "@drawnosaurus/contract";
import { parseMermaidFlowchart } from "./mermaidParser.ts";
import { mermaidToElements } from "./mermaidToElements.ts";

describe("mermaidParser", () => {
  it("parses simple graph TD with rectangles and edges", () => {
    const code = `
      graph TD
      A[Start Service] --> B[Processing]
      B --> C[Finish]
    `;
    const res = parseMermaidFlowchart(code);
    expect(res.direction).toBe("TD");
    expect(res.nodes.length).toBe(3);
    expect(res.edges.length).toBe(2);
    expect(res.nodes[0]?.label).toBe("Start Service");
    expect(res.nodes[0]?.shape).toBe("rectangle");
  });

  it("parses diamonds, ellipses and edge labels", () => {
    const code = `
      flowchart TD
      A((Start)) --> B{Is Valid?}
      B -->|Yes| C[Process]
      B -->|No| D((End))
    `;
    const res = parseMermaidFlowchart(code);
    expect(res.nodes.length).toBe(4);
    const diamond = res.nodes.find((n) => n.id === "B");
    expect(diamond?.shape).toBe("diamond");
    const circle = res.nodes.find((n) => n.id === "A");
    expect(circle?.shape).toBe("ellipse");
    expect(res.edges.some((e) => e.label === "Yes")).toBe(true);
  });

  it("converts parsed diagram to valid DrawElementDto instances", () => {
    const code = `
      graph TD
      A[Input] --> B{Verify}
      B --> C[Output]
    `;
    const parsed = parseMermaidFlowchart(code);
    const elements = mermaidToElements(parsed, 100, 100);

    expect(elements.length).toBeGreaterThanOrEqual(6); // 3 shapes + 3 texts + 2 arrows = 8 elements
    for (const el of elements) {
      const parsedEl = drawElementSchema.safeParse(el);
      expect(
        parsedEl.success,
        `Element ${el.id} (${el.type}) failed validation: ${parsedEl.error?.message}`,
      ).toBe(true);
    }
  });
});
