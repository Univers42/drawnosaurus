#!/usr/bin/env node
/**
 * editor-inspector — semantic access to the running editor, over MCP.
 *
 * The scene, geometry, hit testing and selection live in Rust compiled to WASM and none
 * of it is in the DOM, so an agent debugging this editor from outside has had to infer
 * state from screenshots. This turns "that is probably a rectangle" into
 * `get_element(id)`.
 *
 * Every tool returns JSON as text. Structured output would be tidier, but a diff, a
 * scene and an error all read well as JSON and it keeps the surface uniform.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { canonicalScene, diffScenes } from "./canonical.ts";
import { InspectorSession, type DebugWindow } from "./session.ts";

const session = new InspectorSession();

type Json = Record<string, unknown>;

/** Every tool answers as JSON text, so a caller never has to branch on shape. */
function reply(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

/** The scene as the engine would export it, tombstones included. */
async function readScene(): Promise<Json[]> {
  const page = session.requirePage();
  const json = await page.evaluate(() =>
    (window as never as DebugWindow).__drawEngine!.exportJson(),
  );
  const file = JSON.parse(json) as { elements?: Json[] };
  return file.elements ?? [];
}

const server = new McpServer({ name: "editor-inspector", version: "0.1.0" });

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

server.registerTool(
  "open_board",
  {
    description:
      "Open a board in a browser with the API and websocket stubbed. Requires `make dev` " +
      "to be running — window.__drawEngine exists in DEV builds only. Holds the page " +
      "open across later calls.",
    inputSchema: {
      baseUrl: z.string().optional().describe("Defaults to http://127.0.0.1:5373"),
      slug: z.string().optional(),
    },
  },
  async ({ baseUrl, slug }) => reply(await session.open(baseUrl, slug)),
);

server.registerTool(
  "close_board",
  { description: "Close the browser and drop the session.", inputSchema: {} },
  async () => {
    await session.close();
    return reply({ closed: true });
  },
);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

server.registerTool(
  "get_app_state",
  {
    description:
      "The full debug snapshot: scene counts, viewport, interaction, render timings and " +
      "host counters. The first thing to read when something behaves unexpectedly.",
    inputSchema: {},
  },
  async () => {
    const page = session.requirePage();
    const snapshot = await page.evaluate(() =>
      (window as never as DebugWindow).__drawEngine!.debugSnapshot(),
    );
    return reply({ ...(snapshot as Json), pageErrors: session.takeErrors() });
  },
);

server.registerTool(
  "get_scene",
  {
    description:
      "Every element. `canonical: true` strips ids, seeds and stamps and maps group ids " +
      "to stable indices — use it when comparing, not when debugging one element.",
    inputSchema: { canonical: z.boolean().optional() },
  },
  async ({ canonical }) => {
    const elements = await readScene();
    return reply(canonical ? canonicalScene(elements) : elements);
  },
);

server.registerTool(
  "get_element",
  { description: "One element by id, in full.", inputSchema: { id: z.string() } },
  async ({ id }) => {
    const found = (await readScene()).find((element) => element.id === id);
    return reply(found ?? { error: `no element ${id}` });
  },
);

server.registerTool(
  "get_selected_elements",
  {
    description: "The selected elements in full, not just their ids.",
    inputSchema: {},
  },
  async () => {
    const page = session.requirePage();
    const ids = await page.evaluate(() =>
      (window as never as DebugWindow).__drawEngine!.getSelection(),
    );
    const elements = await readScene();
    return reply(elements.filter((element) => ids.includes(element.id as string)));
  },
);

server.registerTool(
  "export_scene",
  { description: "The raw .osidraw JSON, as a save would write it.", inputSchema: {} },
  async () => {
    const page = session.requirePage();
    return reply(
      JSON.parse(
        await page.evaluate(() => (window as never as DebugWindow).__drawEngine!.exportJson()),
      ),
    );
  },
);

server.registerTool(
  "get_viewport",
  {
    description: "Camera position, zoom, canvas size, dpr and the visible world rect.",
    inputSchema: {},
  },
  async () => {
    const page = session.requirePage();
    const snapshot = (await page.evaluate(() =>
      (window as never as DebugWindow).__drawEngine!.debugSnapshot(),
    )) as Json;
    return reply(snapshot.viewport);
  },
);

server.registerTool(
  "get_canvas_state",
  {
    description:
      "Canvas CSS size against its backing store. A factor-of-two mismatch here is " +
      "always a device-pixel-ratio bug.",
    inputSchema: {},
  },
  async () => {
    const page = session.requirePage();
    return reply(
      await page.evaluate(() => {
        const canvas = document.querySelector("canvas");
        if (!canvas) return { error: "no canvas" };
        const box = canvas.getBoundingClientRect();
        return {
          cssWidth: box.width,
          cssHeight: box.height,
          backingWidth: canvas.width,
          backingHeight: canvas.height,
          impliedDpr: canvas.width / box.width,
          devicePixelRatio: window.devicePixelRatio,
        };
      }),
    );
  },
);

server.registerTool(
  "get_render_stats",
  {
    description:
      "Frame cost as a distribution, elements rendered vs total, and shape-cache hits. " +
      "`reset: true` zeroes the host counters first, to measure one gesture.",
    inputSchema: { reset: z.boolean().optional() },
  },
  async ({ reset }) => {
    const page = session.requirePage();
    if (reset) {
      await page.evaluate(() =>
        (window as never as DebugWindow).__drawEngine!.resetDebugCounters(),
      );
    }
    const snapshot = (await page.evaluate(() =>
      (window as never as DebugWindow).__drawEngine!.debugSnapshot(),
    )) as Json;
    return reply({ rendering: snapshot.rendering, host: snapshot.host, scene: snapshot.scene });
  },
);

server.registerTool(
  "get_pointer_state",
  {
    description: "The gesture in progress, if any, plus the active tool and selection.",
    inputSchema: {},
  },
  async () => {
    const page = session.requirePage();
    const snapshot = (await page.evaluate(() =>
      (window as never as DebugWindow).__drawEngine!.debugSnapshot(),
    )) as Json;
    return reply(snapshot.interaction);
  },
);

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

server.registerTool(
  "hit_test",
  {
    description:
      "What the engine says is under a canvas-relative point. Remember a transparent " +
      "shape is hit on its outline only — the middle of an empty rectangle is a hole.",
    inputSchema: { x: z.number(), y: z.number(), tolerance: z.number().optional() },
  },
  async ({ x, y, tolerance }) => {
    const page = session.requirePage();
    return reply(
      await page.evaluate(
        ([px, py, tol]) =>
          (window as never as DebugWindow).__drawEngine!.hitTest(px!, py!, tol!) ?? null,
        [x, y, tolerance ?? 10] as const,
      ),
    );
  },
);

server.registerTool(
  "inspect_element_at",
  {
    description: "hit_test, then the whole element it found. The usual first question.",
    inputSchema: { x: z.number(), y: z.number(), tolerance: z.number().optional() },
  },
  async ({ x, y, tolerance }) => {
    const page = session.requirePage();
    const hit = (await page.evaluate(
      ([px, py, tol]) =>
        (window as never as DebugWindow).__drawEngine!.hitTest(px!, py!, tol!) ?? null,
      [x, y, tolerance ?? 10] as const,
    )) as Json | null;
    if (!hit) return reply({ hit: null });
    const full = (await readScene()).find((element) => element.id === hit.id);
    return reply({ hit: full ?? hit });
  },
);

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

const StepSchema = z.object({
  action: z.enum(["down", "move", "up", "click", "dblclick"]),
  x: z.number().optional(),
  y: z.number().optional(),
  shift: z.boolean().optional(),
  alt: z.boolean().optional(),
});

server.registerTool(
  "pointer",
  {
    description:
      "Drive a pointer sequence in canvas-relative coordinates. Use SEVERAL move steps " +
      "for a drag: a single-move drag cannot detect compounding bugs, which is how they " +
      "survive. Keep gestures clear of the floating chrome, which swallows them silently.",
    inputSchema: { steps: z.array(StepSchema).min(1) },
  },
  async ({ steps }) => {
    const page = session.requirePage();
    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("the canvas has no box — is the board open?");

    for (const step of steps) {
      const at = { x: box.x + (step.x ?? 0), y: box.y + (step.y ?? 0) };
      const modifiers: ("Shift" | "Alt")[] = [];
      if (step.shift) modifiers.push("Shift");
      if (step.alt) modifiers.push("Alt");
      for (const key of modifiers) await page.keyboard.down(key);
      switch (step.action) {
        case "down":
          await page.mouse.move(at.x, at.y);
          await page.mouse.down();
          break;
        case "move":
          await page.mouse.move(at.x, at.y);
          break;
        case "up":
          await page.mouse.up();
          break;
        case "click":
          await page.mouse.click(at.x, at.y);
          break;
        case "dblclick":
          await page.mouse.dblclick(at.x, at.y);
          break;
      }
      for (const key of modifiers) await page.keyboard.up(key);
    }
    // The engine coalesces moves to one step per animation frame, so a sequence that
    // returns immediately can be read back before the last move has been applied.
    await page.waitForTimeout(120);
    session.record("pointer", JSON.stringify(steps));
    return reply({ applied: steps.length, pageErrors: session.takeErrors() });
  },
);

server.registerTool(
  "key",
  {
    description:
      "Press keys, e.g. 'Control+g' or 'Escape'. The key listener is on the editor " +
      "container, so the board must have been clicked at least once first.",
    inputSchema: { keys: z.array(z.string()).min(1) },
  },
  async ({ keys }) => {
    const page = session.requirePage();
    for (const key of keys) await page.keyboard.press(key);
    await page.waitForTimeout(80);
    session.record("key", keys.join(" "));
    return reply({ pressed: keys, pageErrors: session.takeErrors() });
  },
);

server.registerTool(
  "tool",
  {
    description: "Select a tool by engine name: select, rectangle, line, freedraw, …",
    inputSchema: { name: z.string() },
  },
  async ({ name }) => {
    const page = session.requirePage();
    await page.evaluate(
      (tool) => (window as never as DebugWindow).__drawEngine!.setTool(tool),
      name,
    );
    session.record("tool", name);
    return reply({ tool: name });
  },
);

// ---------------------------------------------------------------------------
// Pixels
// ---------------------------------------------------------------------------

server.registerTool(
  "screenshot_canvas",
  { description: "A PNG of the canvas, base64.", inputSchema: {} },
  async () => {
    const page = session.requirePage();
    const shot = await page.locator("canvas").first().screenshot();
    return {
      content: [{ type: "image" as const, data: shot.toString("base64"), mimeType: "image/png" }],
    };
  },
);

server.registerTool(
  "region_ink",
  {
    description:
      "The fraction of a canvas region that differs from the background. Point it at a " +
      "patch that should be EMPTY unless the thing you are looking for is there, and " +
      "take a control from the same patch before the change — whole-canvas ink cannot " +
      "see a one-pixel outline.",
    inputSchema: {
      left: z.number(),
      top: z.number(),
      right: z.number(),
      bottom: z.number(),
    },
  },
  async (region) => {
    const page = session.requirePage();
    return reply({
      ink: await page.evaluate((area) => {
        const canvas = document.querySelector("canvas");
        if (!canvas) throw new Error("no canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2d context");
        const box = canvas.getBoundingClientRect();
        const sx = canvas.width / box.width;
        const sy = canvas.height / box.height;
        const w = Math.round((area.right - area.left) * sx);
        const h = Math.round((area.bottom - area.top) * sy);
        if (w <= 0 || h <= 0) throw new Error("empty region");
        const corner = ctx.getImageData(0, 0, 1, 1).data;
        const { data } = ctx.getImageData(
          Math.round(area.left * sx),
          Math.round(area.top * sy),
          w,
          h,
        );
        let ink = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (
            Math.abs(data[i]! - corner[0]!) > 12 ||
            Math.abs(data[i + 1]! - corner[1]!) > 12 ||
            Math.abs(data[i + 2]! - corner[2]!) > 12
          ) {
            ink += 1;
          }
        }
        return ink / (w * h);
      }, region),
    });
  },
);

// ---------------------------------------------------------------------------
// History and differential
// ---------------------------------------------------------------------------

server.registerTool(
  "get_event_history",
  {
    description: "What this session has driven, in order. For reconstructing a repro.",
    inputSchema: {},
  },
  async () => reply(session.history()),
);

server.registerTool(
  "compare_scene",
  {
    description:
      "Compare the live scene against a reference (an .excalidraw or .osidraw element " +
      "array) in canonical form: ids, seeds and stamps dropped, coordinates rounded, " +
      "group ids mapped to stable indices. The mapping is what makes a nested-group " +
      "comparison possible at all — group ids are random per session.",
    inputSchema: {
      reference: z.array(z.record(z.string(), z.unknown())).describe("Reference elements"),
      precision: z.number().optional(),
    },
  },
  async ({ reference, precision }) => {
    const ours = canonicalScene(await readScene(), { precision });
    const theirs = canonicalScene(reference as Json[], { precision });
    return reply({ ...diffScenes(ours, theirs), ours, reference: theirs });
  },
);

await server.connect(new StdioServerTransport());
