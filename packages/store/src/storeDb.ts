/**
 * The database under the store's handlers. Two implementations: `memory.ts` for the unit
 * tests and the dev server, `d1.ts` for Cloudflare. The handlers decide every write on a
 * `Head` they read; the database's one job beyond storing is to land that write only if the
 * head is still the one read, so two writers cannot both win.
 */

/** The scene's item. A picture's item is its id, which the slug rule keeps from being empty. */
export const SCENE = "";

/** What a write is decided on. */
export interface Head {
  /** The scene's revision: 0 until a scene is written, since a picture can come first. */
  rev: number;
  /** Hex SHA-256 of the write token, fixed by the drawing's first write. */
  proof: string;
  /** New on every write. */
  nonce: string;
  /** The scene and the pictures together, as the size cap counts them. */
  bytes: number;
  sceneBytes: number;
  pictures: number;
}

export interface Write {
  id: string;
  /** The nonce of the head this write was decided on, or null when there was none. */
  seen: string | null;
  /** The head after this write, with a nonce of its own. */
  head: Head;
  writtenAt: number;
  /** `SCENE`, or a picture's id. The item's parts are replaced by `parts`. */
  item: string;
  parts: readonly Uint8Array[];
  /** Drawings last written before `before` that this write deletes, at most `limit`. */
  sweep: { before: number; limit: number };
}

export interface StoreDb {
  head(id: string): Promise<Head | null>;
  /** The scene's parts in order, with the rev they are; null when nothing was written. */
  scene(id: string): Promise<{ rev: number; parts: Uint8Array[] } | null>;
  /** A picture's parts in order; null when there is none. */
  picture(id: string, pid: string): Promise<Uint8Array[] | null>;
  /**
   * Lands `write` and its sweep only if the drawing's nonce is still `write.seen`, all or
   * nothing. False means nothing changed.
   */
  write(write: Write): Promise<boolean>;
}
