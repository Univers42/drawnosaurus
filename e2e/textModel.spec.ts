import { expect, test } from "./fixtures.ts";
import { openBoard } from "./board.ts";
import { patchElementsSchema } from "../packages/contract/src/board.ts";
import { drawElementSchema } from "../packages/contract/src/element.ts";

/**
 * The engine and the contract hold one rule for a text's font family and line height.
 *
 * The server refuses a whole patch for one value out of range, and the autosave resends
 * an unacknowledged element with every later change, so a scene holding one — opened
 * from a file, sent by a peer — would never save again. The engine keeps what the
 * contract accepts and drops the rest where it comes in. Each side pins its own half
 * (`ci_text_model_compat.rs`, `packages/contract/tests/element.test.ts`); this is where
 * they meet, so neither range can move without the other.
 */

/** A free text as the engine exports one, with every field the contract requires. */
const TEXT = {
  type: "text",
  x: 0,
  y: 0,
  width: 60,
  height: 25,
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "hachure",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  roundness: null,
  seed: 1,
  text: "hello",
  fontSize: 20,
  groupIds: [],
  version: 1,
  versionNonce: 1,
  updated: 0,
  isDeleted: false,
} as const;

const EDGES: Record<string, number>[] = [
  { fontFamily: 0 },
  { fontFamily: 1 },
  { fontFamily: 64 },
  { fontFamily: 65 },
  { fontFamily: 99 },
  { fontFamily: 255 },
  { fontFamily: 1.5 },
  { lineHeight: 0.01 },
  { lineHeight: 0.49 },
  { lineHeight: 0.5 },
  { lineHeight: 4 },
  { lineHeight: 4.01 },
];

test("the engine keeps a text's family and line height exactly when the server would", async ({
  page,
}) => {
  await openBoard(page);
  const elements = EDGES.map((fields, i) => ({ ...TEXT, id: `text-${i}`, ...fields }));

  const exported = await page.evaluate((elements) => {
    const engine = window.__drawEngine!;
    if (!engine.loadScene(JSON.stringify({ type: "osidraw", version: 1, elements }))) {
      throw new Error("the scene was refused");
    }
    return JSON.parse(engine.exportJson()).elements as Record<string, unknown>[];
  }, elements);

  // Whatever came in, what goes out is a patch the server accepts.
  const patch = patchElementsSchema.safeParse({ elements: exported });
  expect(patch.error?.issues ?? []).toEqual([]);

  // And nothing the server would have kept is lost on the way.
  const byId = new Map(exported.map((element) => [element.id, element]));
  for (const [i, fields] of EDGES.entries()) {
    const [key, value] = Object.entries(fields)[0]!;
    const accepted = drawElementSchema.safeParse({ ...TEXT, id: "x", ...fields }).success;
    expect(byId.get(`text-${i}`)?.[key], JSON.stringify(fields)).toBe(accepted ? value : undefined);
  }
});
