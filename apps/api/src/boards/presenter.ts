import {
  SUPPORTED_OSIDRAW_VERSION,
  liveElements,
  type Board,
  type BoardSummary,
} from "@drawnosaurus/contract";
import type { BoardDoc } from "../mongo.ts";

/**
 * Document to wire shape. Nothing internal crosses the boundary: `_id`, `ownerId`,
 * and `deletedAt` stay server-side, and dates go out as ISO strings.
 */
export function toSummary(doc: BoardDoc): BoardSummary {
  return {
    slug: doc.slug,
    title: doc.title,
    elementCount: doc.elementCount,
    bounds: doc.bounds,
    rev: doc.rev,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/**
 * The full board, with elements wrapped back into the `.osidraw` envelope the
 * engine parses. Tombstones are dropped on the way out — they exist so a delete
 * can win a merge, and the client rebuilds its own as it edits.
 */
export function toBoard(doc: BoardDoc, options: { tombstones?: boolean } = {}): Board {
  return {
    ...toSummary(doc),
    scene: {
      type: "osidraw",
      version: SUPPORTED_OSIDRAW_VERSION,
      // With them when asked: see `boardQuerySchema`.
      elements: options.tombstones ? doc.elements : liveElements(doc.elements),
    },
  };
}
