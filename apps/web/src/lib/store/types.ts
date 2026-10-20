import type { Board, BoardList, BoardSummary, OsidrawFile } from "@drawnosaurus/contract";
import type { PatchAck } from "../api/client.ts";
import type { ScenePatch, StampedElement } from "../autosave/sceneDiff.ts";

/**
 * The board operations the app needs, whatever holds the boards: the API (Docker build)
 * or the browser's own storage (public build). Signatures are `api/client.ts`'s.
 *
 * Every implementation fails with `ApiClientError`, so `classify` and the 403/409/413
 * handling stay the same. Share and tunnel calls are not here: they are Docker-only.
 */
export interface BoardStore {
  list(limit?: number, cursor?: string): Promise<BoardList>;
  create(title: string): Promise<BoardSummary>;
  /** `tombstones` includes deleted elements, for catching up after a lost connection. */
  get(slug: string, options?: { tombstones?: boolean }): Promise<Board>;
  patchElements<T extends StampedElement>(slug: string, patch: ScenePatch<T>): Promise<PatchAck>;
  /** Full replace. `rev` is the one the caller last saw; a mismatch is a 409. */
  replace(slug: string, scene: OsidrawFile, rev: number): Promise<Board>;
  remove(slug: string): Promise<void>;
  putThumbnail(slug: string, blob: Blob): Promise<void>;
  /**
   * Where the gallery loads a board's picture from, or null when there is none; `version`
   * (its `thumbnailAt`) busts the cache. Async because the browser's store reads the
   * picture from IndexedDB, and its address is an object URL the caller must revoke.
   */
  thumbnail(slug: string, version: string): Promise<string | null>;
}
