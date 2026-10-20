/**
 * The database under the store's handlers. Two implementations: `memory.ts` for the unit
 * tests and the dev server, `d1.ts` for Cloudflare. The handlers decide every write on a
 * `Head` they read; the database's one job beyond storing is to land that write only if the
 * head is still the one read, so two writers cannot both win. Every write to a drawing's
 * parts goes through its head, so a head unchanged means its parts are unchanged too.
 */

/**
 * The items a drawing's parts belong to: the scene is `SCENE`, a picture is its id, and a
 * scene being staged is `staged(upload id)`. The slug rule keeps a picture's id from being
 * empty or starting with `@`.
 */
export const SCENE = "";
export const staged = (sid: string): string => `@${sid}`;

/** What a write is decided on. */
export interface Head {
  /** The scene's revision: 0 until a scene is written, since a picture can come first. */
  rev: number;
  /** Hex SHA-256 of the write token, fixed by the drawing's first write. */
  proof: string;
  /** New on every write. */
  nonce: string;
  /** The scene, the pictures and the staged parts together, as the size cap counts them. */
  bytes: number;
  sceneBytes: number;
  pictures: number;
  /** What every staged upload of the drawing holds, and when a staged part last landed. */
  stagedBytes: number;
  stagedAt: number;
}

/** One stored part, and the number of parts its item was declared with. */
export interface Part {
  total: number;
  bytes: Uint8Array<ArrayBuffer>;
}

/** How far an item's upload has come: `parts` of `total` in, `bytes` long so far. */
export interface Item {
  parts: number;
  total: number;
  bytes: number;
}

/** What a write does to the drawing's parts, applied in order after its head. */
export type Change =
  /** Stores one part, in place of any at that place. */
  | { kind: "put"; item: string; n: number; total: number; bytes: Uint8Array<ArrayBuffer> }
  /** Deletes an item's parts from `from` on. */
  | { kind: "trim"; item: string; from: number }
  /** Gives one item's parts to another, which holds none. */
  | { kind: "rename"; from: string; to: string }
  /** Deletes every staged upload of the drawing. */
  | { kind: "dropStaged" };

export interface Write {
  id: string;
  /** The nonce of the head this write was decided on, or null when there was none. */
  seen: string | null;
  /** The head after this write, with a nonce of its own. */
  head: Head;
  writtenAt: number;
  changes: readonly Change[];
  /** Drawings last written before `before` that this write deletes, at most `limit`. */
  sweep: { before: number; limit: number };
}

export interface StoreDb {
  head(id: string): Promise<Head | null>;
  /** Null when the item has no part stored. */
  item(id: string, item: string): Promise<Item | null>;
  part(id: string, item: string, n: number): Promise<Part | null>;
  /** The scene's part `n` with the rev it is part of, read together; null with no drawing. */
  scene(id: string, n: number): Promise<{ rev: number; part: Part | null } | null>;
  /**
   * Lands `write` and its sweep only if the drawing's nonce is still `write.seen`, all or
   * nothing. False means nothing changed.
   */
  write(write: Write): Promise<boolean>;
}
