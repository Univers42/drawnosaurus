/**
 * The database under the store's handlers. Two implementations: `memory.ts` for the unit
 * tests and the dev server, `d1.ts` for Cloudflare. The handlers decide every write on a
 * `Head` they read; the database's one job beyond storing is to land that write only if the
 * head is still the one read, so two writers cannot both win. Every write to a drawing's
 * parts goes through its head, so a head unchanged means its parts are unchanged too.
 */

/**
 * The items a drawing's parts belong to: the scene is `SCENE`, a complete picture is its id,
 * a scene being staged is `staged(upload id)`, and a picture still being sent is
 * `pending(picture id, upload id)`. The slug rule keeps an id from being empty or starting
 * with `@` or `#`.
 */
export const SCENE = "";
export const staged = (sid: string): string => `@${sid}`;
export const pending = (pid: string, uid: string): string => `#${pid}:${uid}`;

/** What a write is decided on. */
export interface Head {
  /** The scene's revision: 0 until a scene is written, since a picture can come first. */
  rev: number;
  /** Hex SHA-256 of the write token, fixed by the drawing's first write. */
  proof: string;
  /** New on every write. */
  nonce: string;
  /** Everything stored: the scene, the pictures, the staged scenes and the pending pictures. */
  bytes: number;
  sceneBytes: number;
  /** Complete pictures. */
  pictures: number;
  /** What the staged scenes hold, and when a staged part last landed. */
  stagedBytes: number;
  stagedAt: number;
  /** What the pictures still being sent hold, and when a part of one last landed. */
  pendingBytes: number;
  pendingAt: number;
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

/** What a read finds: the drawing, an item of it, and one part of that item. */
export interface Read {
  rev: number;
  writtenAt: number;
  item: Item | null;
  part: Part | null;
}

/** What a write does to the drawing's parts, applied in order after its head. */
export type Change =
  /** Stores one part, in place of any at that place. */
  | { kind: "put"; item: string; n: number; total: number; bytes: Uint8Array<ArrayBuffer> }
  /** Deletes an item's parts from `from` on. */
  | { kind: "trim"; item: string; from: number }
  /** Gives one item's parts to another, which holds none. */
  | { kind: "rename"; from: string; to: string }
  /** Deletes every staged scene of the drawing. */
  | { kind: "dropStaged" }
  /** Deletes every picture of the drawing still being sent. */
  | { kind: "dropPending" };

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
  /** The drawing, its `item` and that item's part `n`, read together; null with no drawing. */
  read(id: string, item: string, n: number): Promise<Read | null>;
  /**
   * Lands `write` and its sweep only if the drawing's nonce is still `write.seen`, all or
   * nothing. False means nothing changed.
   */
  write(write: Write): Promise<boolean>;
}
