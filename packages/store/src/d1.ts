import { Buffer } from "node:buffer";
import { SCENE, type Head, type StoreDb } from "./storeDb.ts";

/*
 * The part of D1's Worker API the store calls, declared here rather than taken from
 * @cloudflare/workers-types: https://developers.cloudflare.com/d1/worker-api/
 */
export interface D1Result<T> {
  results: T[];
  meta: { changes: number };
}

export interface D1PreparedStatement {
  bind(...values: (string | number)[]): D1PreparedStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

/**
 * Parts are stored as base64 text, not as BLOBs. The binding sends a BLOB as `Array.from` of
 * its bytes and reads one back as an array of numbers (the type conversion table's note 4,
 * https://developers.cloudflare.com/d1/worker-api/), so every byte costs a JSON number.
 * Base64 goes through Node's `Buffer`, hence `nodejs_compat` in wrangler.toml.
 */
export const encodePart = (part: Uint8Array): string =>
  Buffer.from(part.buffer, part.byteOffset, part.byteLength).toString("base64");

export const decodePart = (text: string): Uint8Array => Buffer.from(text, "base64");

interface HeadRow {
  rev: number;
  proof: string;
  nonce: string;
  bytes: number;
  scene_bytes: number;
  pictures: number;
}

const toHead = (row: HeadRow): Head => ({
  rev: row.rev,
  proof: row.proof,
  nonce: row.nonce,
  bytes: row.bytes,
  sceneBytes: row.scene_bytes,
  pictures: row.pictures,
});

/** The store's database on D1, as `migrations/0001_init.sql` lays it out. */
export function d1Store(db: D1Database): StoreDb {
  const partsOf = (id: string, item: string): D1PreparedStatement =>
    db
      .prepare("SELECT data FROM parts WHERE drawing_id = ?1 AND item = ?2 ORDER BY n")
      .bind(id, item);

  return {
    async head(id) {
      const row = await db
        .prepare(
          "SELECT rev, proof, nonce, bytes, scene_bytes, pictures FROM drawings WHERE id = ?1",
        )
        .bind(id)
        .first<HeadRow>();
      return row === null ? null : toHead(row);
    },

    async scene(id) {
      // One batch is one transaction, so the rev and the parts are of the same write.
      const [revs, rows] = (await db.batch([
        db.prepare("SELECT rev FROM drawings WHERE id = ?1").bind(id),
        partsOf(id, SCENE),
      ])) as [D1Result<{ rev: number }>, D1Result<{ data: string }>];
      const head = revs.results[0];
      return head === undefined
        ? null
        : { rev: head.rev, parts: rows.results.map((row) => decodePart(row.data)) };
    },

    async picture(id, pid) {
      const { results } = await partsOf(id, pid).all<{ data: string }>();
      return results.length === 0 ? null : results.map((row) => decodePart(row.data));
    },

    async write(write) {
      const head = write.head;
      await db
        .prepare(
          `INSERT INTO drawings (id, nonce, rev, proof, written_at, bytes, scene_bytes, pictures)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
           ON CONFLICT (id) DO UPDATE SET nonce = excluded.nonce, rev = excluded.rev,
             written_at = excluded.written_at, bytes = excluded.bytes,
             scene_bytes = excluded.scene_bytes, pictures = excluded.pictures`,
        )
        .bind(
          write.id,
          head.nonce,
          head.rev,
          head.proof,
          write.writtenAt,
          head.bytes,
          head.sceneBytes,
          head.pictures,
        )
        .all();
      await db
        .prepare("DELETE FROM parts WHERE drawing_id = ?1 AND item = ?2")
        .bind(write.id, write.item)
        .all();
      for (const [n, part] of write.parts.entries()) {
        await db
          .prepare("INSERT INTO parts (drawing_id, item, n, data) VALUES (?1, ?2, ?3, ?4)")
          .bind(write.id, write.item, n, encodePart(part))
          .all();
      }
      return true;
    },
  };
}
