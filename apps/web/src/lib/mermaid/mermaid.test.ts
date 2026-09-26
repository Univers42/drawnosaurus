import { describe, expect, it } from "vitest";
import { drawElementSchema, type DrawElementDto } from "@drawnosaurus/contract";
import {
  NOT_EDITABLE,
  SkeletonError,
  restoreEntities,
  skeletonToElements,
  type Skeleton,
} from "./skeleton.ts";
import { looksLikeMermaid } from "./importMermaid.ts";

/**
 * The skeletons below are shaped as `@excalidraw/mermaid-to-excalidraw` writes them —
 * `converter/types/flowchart.js`, `class.js`, `graphImage.js` — so the converter is pinned
 * without Mermaid, which needs a browser to lay a diagram out (`e2e/mermaid*.spec.ts`).
 */

const node = (id: string, x: number, text?: string): Skeleton => ({
  id,
  type: "rectangle",
  x,
  y: 0,
  width: 100,
  height: 40,
  strokeWidth: 2,
  ...(text ? { label: { text, fontSize: 20 } } : {}),
});

const byType = (elements: DrawElementDto[], type: string) =>
  elements.filter((element) => element.type === type);

describe("skeletonToElements", () => {
  it("gives a labelled shape its label, bound both ways and left for the engine to size", () => {
    const elements = skeletonToElements({ elements: [node("A", 0, "Start")] });
    const [shape] = byType(elements, "rectangle");
    const [label] = byType(elements, "text");
    expect(shape!.boundTextId).toBe(label!.id);
    expect(label!.containerId).toBe(shape!.id);
    expect([label!.text, label!.originalText, label!.fontSize]).toEqual(["Start", "Start", 20]);
    expect([label!.textAlign, label!.verticalAlign]).toEqual(["center", "middle"]);
    expect([label!.width, label!.height]).toEqual([0, 0]);
  });

  it("binds an arrow to the shapes its start and end name, label and points kept", () => {
    const elements = skeletonToElements({
      elements: [
        node("A", 0),
        node("B", 200),
        {
          id: "A_B",
          type: "arrow",
          x: 100,
          y: 20,
          points: [
            [0, 0],
            [50, 30],
            [100, 0],
          ],
          label: { text: "go" },
          start: { id: "A" },
          end: { id: "B" },
          roundness: { type: 2 },
        },
      ],
    });
    const [a, b] = byType(elements, "rectangle");
    const [arrow] = byType(elements, "arrow");
    expect([arrow!.startBinding, arrow!.endBinding]).toEqual([a!.id, b!.id]);
    expect([arrow!.width, arrow!.height]).toEqual([100, 30]);
    expect([arrow!.startArrowhead, arrow!.endArrowhead]).toEqual(["none", "arrow"]);
    expect(arrow!.roundness).not.toBeNull();
    expect(byType(elements, "text")[0]!.containerId).toBe(arrow!.id);
  });

  it("binds an end only to a shape it reaches, so a message stays on its lifelines", () => {
    // The sequence converter binds each message to the boxes atop both lifelines.
    const [, , arrow] = skeletonToElements({
      elements: [
        node("A", 0),
        node("B", 200),
        {
          type: "arrow",
          x: 50,
          y: 300,
          points: [
            [0, 0],
            [200, 0],
          ],
          start: { id: "A" },
          end: { id: "B" },
        },
      ],
    });
    expect([arrow!.startBinding, arrow!.endBinding]).toEqual([undefined, undefined]);
    expect([arrow!.x, arrow!.y]).toEqual([50, 300]);
  });

  it("reads arrowheads as the converter writes them: null is none, a crow's foot kept", () => {
    const [arrow] = skeletonToElements({
      elements: [
        {
          type: "arrow",
          x: 0,
          y: 0,
          width: 10,
          height: 0,
          startArrowhead: null,
          endArrowhead: "crowfoot_many",
        },
      ],
    });
    expect([arrow!.startArrowhead, arrow!.endArrowhead]).toEqual(["none", "crowfoot_many"]);
  });

  it("frames what a frame lists, 10 around, under what it holds", () => {
    const elements = skeletonToElements({
      elements: [
        node("A", 0, "a"),
        node("B", 200, "b"),
        { type: "frame", name: "ns", children: ["A", "B"] },
      ],
    });
    const frame = elements[0]!;
    expect(frame.type).toBe("frame");
    expect([frame.x, frame.y, frame.width, frame.height]).toEqual([-10, -10, 320, 60]);
    expect(frame.name).toBe("ns");
    for (const element of elements.slice(1)) expect(element.frameId).toBe(frame.id);
  });

  it("puts a picture in with a badge saying it is one, grouped so they move together", () => {
    const dataURL = "data:image/svg+xml;base64,PHN2Zy8+";
    const [image, badge] = skeletonToElements({
      elements: [{ type: "image", x: 0, y: 0, width: 300, height: 200, fileId: "f" }],
      files: { f: { dataURL } },
    });
    expect(image!.dataUrl).toBe(dataURL);
    expect(badge!.text).toBe(NOT_EDITABLE);
    expect(badge!.y).toBeGreaterThan(image!.y + image!.height);
    expect(image!.groupIds).toHaveLength(1);
    expect(badge!.groupIds).toEqual(image!.groupIds);
  });

  it("leaves out what has nowhere finite to go and keeps the rest", () => {
    // Mermaid lays an empty sequence block out at NaN, and what follows it.
    const nan = { ...node("A", 0, "lost"), x: Number.NaN };
    const infinite: Skeleton = {
      type: "line",
      x: 0,
      y: 0,
      points: [
        [0, 0],
        [Infinity, 1],
      ],
    };
    const elements = skeletonToElements({
      elements: [nan, infinite, { type: "hexagon" }, node("B", 200, "kept")],
    });
    expect(elements.map((element) => element.type)).toEqual(["rectangle", "text"]);
    expect(elements[1]!.text).toBe("kept");
  });

  it("throws when nothing at all could be placed", () => {
    const nan = { ...node("A", 0), x: Number.NaN };
    expect(() => skeletonToElements({ elements: [nan] })).toThrow(SkeletonError);
    expect(() => skeletonToElements({ elements: [{ type: "hexagon" }] })).toThrow(SkeletonError);
  });

  it("writes the entity codes the converter left hidden as what they stand for", () => {
    const [, , arrow, title] = skeletonToElements({
      elements: [
        node("A", 0),
        node("B", 200),
        { type: "arrow", x: 0, y: 0, width: 10, height: 0, label: { text: "xﬂ°lt¶ßy ﬂ°°9829¶ß ﬂ°zz¶ß" } },
      ],
    });
    expect(arrow!.type).toBe("arrow");
    expect(title!.text).toBe("x<y ♥ #zz;");
    expect(restoreEntities("a ﬂ°amp¶ß b")).toBe("a & b");
  });

  it("writes only what the server accepts", () => {
    const styled: Skeleton = {
      ...node("B", 200, "b"),
      strokeColor: "#f66",
      backgroundColor: "#f9f",
      strokeStyle: "dashed",
    };
    const elements = skeletonToElements({
      elements: [
        node("A", 0, "a"),
        styled,
        { type: "arrow", x: 0, y: 0, width: 10, height: 10, start: { id: "A" }, end: { id: "B" } },
        { type: "text", x: 0, y: 100, text: "note" },
        { type: "line", x: 0, y: 0, width: 0, height: 80 },
        { type: "frame", children: ["A"] },
      ],
    });
    for (const element of elements) {
      expect(drawElementSchema.safeParse(element).success, element.type).toBe(true);
    }
  });
});

describe("looksLikeMermaid", () => {
  it("takes a definition by its first keyword, a directive before it allowed", () => {
    expect(looksLikeMermaid("flowchart TD\n A-->B")).toBe(true);
    expect(looksLikeMermaid("  sequenceDiagram\n A->>B: hi")).toBe(true);
    expect(looksLikeMermaid("%%{init: {'theme': 'dark'}}%%\ngraph LR\n A-->B")).toBe(true);
    expect(looksLikeMermaid("xychart-beta\n x-axis [a, b]")).toBe(true);
  });

  it("leaves ordinary text alone", () => {
    expect(looksLikeMermaid("graphs are nice")).toBe(false);
    expect(looksLikeMermaid("hello flowchart")).toBe(false);
    expect(looksLikeMermaid("")).toBe(false);
  });
});
