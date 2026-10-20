import { Buffer } from "node:buffer";
import { SCENE, type Change, type Head, type Part, type StoreDb } from "./storeDb.ts";

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
 * https://developers.cloudflare.com/d1/worker-api/), so every byte costs a JSON number: about
 * 35 ms of CPU per MiB written and 12 per MiB read, against 2.9 and 0.8 as base64
 * (tests/d1Codec.bench.ts), on a plan that allows 10 ms a request. Base64 is a third larger
 * to store, which `PART_BYTES` and `MAX_DRAWING_BYTES` allow for. It goes through Node's
 * `Buffer`, native in both Node and the Workers runtime, hence `nodejs_compat` in
 * wrangler.toml.
 */
export const encodePart = (part: Uint8Array): string =>
  Buffer.from(part.buffer, part.byteOffset, part.byteLength).toString("base64");

export const decodePart = (text: string): Uint8Array<ArrayBuffer> => Buffer.from(text, "base64");

interface HeadRow {
  rev: number;
  proof: string;
  nonce: string;
  bytes: number;
  scene_bytes: number;
  pictures: number;
  staged_bytes: number;
  staged_at: number;
}

const toHead = (row: HeadRow): Head => ({
  rev: row.rev,
  proof: row.proof,
  nonce: row.nonce,
  bytes: row.bytes,
  sceneBytes: row.scene_bytes,
  pictures: row.pictures,
  stagedBytes: row.staged_bytes,
  stagedAt: row.staged_at,
});

interface PartRow {
  total: number;
  data: string;
}

const toPart = (row: PartRow | undefined | null): Part | null =>
  row ? { total: row.total, bytes: decodePart(row.data) } : null;

// ?1 and ?2 are the drawing and the new nonce in every statement after the claim.
const LANDED = "EXISTS (SELECT 1 FROM drawings WHERE id = ?1 AND nonce = ?2)";

/** The SQL of each change, bound after ?1 and ?2. */
const CHANGES = {
  put: `INSERT INTO parts (drawing_id, item, n, total, size, data)
        SELECT ?1, ?3, ?4, ?5, ?6, ?7 WHERE ${LANDED}
        ON CONFLICT (drawing_id, item, n) DO UPDATE
        SET total = excluded.total, size = excluded.size, data = excluded.data`,
  trim: `DELETE FROM parts WHERE drawing_id = ?1 AND item = ?3 AND n >= ?4 AND ${LANDED}`,
  rename: `UPDATE parts SET item = ?4 WHERE drawing_id = ?1 AND item = ?3 AND ${LANDED}`,
  // GLOB, not LIKE: case-sensitive, so SQLite reads it as a range on the key.
  dropStaged: `DELETE FROM parts WHERE drawing_id = ?1 AND item GLOB '@*' AND ${LANDED}`,
} as const;

const bindings = (change: Change): (string | number)[] => {
  switch (change.kind) {
    case "put":
      return [
        change.item,
        change.n,
        change.total,
        change.bytes.byteLength,
        encodePart(change.bytes),
      ];
    case "trim":
      return [change.item, change.from];
    case "rename":
      return [change.from, change.to];
    case "dropStaged":
      return [];
  }
};

/** The store's database on D1, as `migrations/0001_init.sql` lays it out. */
export function d1Store(db: D1Database): StoreDb {
  const partOf = (id: string, item: string, n: number): D1PreparedStatement =>
    db
      .prepare("SELECT total, data FROM parts WHERE drawing_id = ?1 AND item = ?2 AND n = ?3")
      .bind(id, item, n);

  return {
    async head(id) {
      const row = await db
        .prepare(
          `SELECT rev, proof, nonce, bytes, scene_bytes, pictures, staged_bytes, staged_at
           FROM drawings WHERE id = ?1`,
        )
        .bind(id)
        .first<HeadRow>();
      return row === null ? null : toHead(row);
    },

    async item(id, item) {
      const row = await db
        .prepare(
          `SELECT count(*) AS parts, max(total) AS total, sum(size) AS bytes
           FROM parts WHERE drawing_id = ?1 AND item = ?2`,
        )
        .bind(id, item)
        .first<{ parts: number; total: number; bytes: number }>();
      return row === null || row.parts === 0 ? null : row;
    },

    async part(id, item, n) {
      return toPart(await partOf(id, item, n).first<PartRow>());
    },

    async scene(id, n) {
      // One batch is one transaction, so the rev and the part are of the same write.
      const [revs, rows] = (await db.batch([
        db.prepare("SELECT rev FROM drawings WHERE id = ?1").bind(id),
        partOf(id, SCENE, n),
      ])) as [D1Result<{ rev: number }>, D1Result<PartRow>];
      const head = revs.results[0];
      return head === undefined ? null : { rev: head.rev, part: toPart(rows.results[0]) };
    },

    /**
     * One batch, which D1 runs as one transaction: "Batched statements are SQL transactions"
     * and "each statement in the list will execute and commit, sequentially,
     * non-concurrently" (https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
     * The first statement is the compare-and-swap: it sets the new nonce only where the old
     * one is still there. Every later statement runs only where the new nonce is, so when the
     * swap loses, the whole batch changes nothing — no error needed, and none to tell apart.
     */
    async write(write) {
      const { id, head } = write;
      const claim =
        write.seen === null
          ? db
              .prepare(
                `INSERT INTO drawings (id, nonce, rev, proof, written_at, bytes, scene_bytes,
                   pictures, staged_bytes, staged_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) ON CONFLICT (id) DO NOTHING`,
              )
              .bind(
                id,
                head.nonce,
                head.rev,
                head.proof,
                write.writtenAt,
                head.bytes,
                head.sceneBytes,
                head.pictures,
                head.stagedBytes,
                head.stagedAt,
              )
          : db
              .prepare(
                `UPDATE drawings SET nonce = ?2, rev = ?3, written_at = ?4, bytes = ?5,
                   scene_bytes = ?6, pictures = ?7, staged_bytes = ?8, staged_at = ?9
                 WHERE id = ?1 AND nonce = ?10`,
              )
              .bind(
                id,
                head.nonce,
                head.rev,
                write.writtenAt,
                head.bytes,
                head.sceneBytes,
                head.pictures,
                head.stagedBytes,
                head.stagedAt,
                write.seen,
              );
      const changes = write.changes.map((change) =>
        db.prepare(CHANGES[change.kind]).bind(id, head.nonce, ...bindings(change)),
      );
      // Both deletes pick the same drawings: nothing changes `drawings` between them.
      const expired =
        "SELECT id FROM drawings WHERE written_at < ?3 ORDER BY written_at, id LIMIT ?4";
      const sweep = [
        `DELETE FROM parts WHERE drawing_id IN (${expired}) AND ${LANDED}`,
        `DELETE FROM drawings WHERE id IN (${expired}) AND ${LANDED}`,
      ].map((sql) => db.prepare(sql).bind(id, head.nonce, write.sweep.before, write.sweep.limit));

      const [swap] = await db.batch([claim, ...changes, ...sweep]);
      return swap?.meta.changes === 1;
    },
  };
}
