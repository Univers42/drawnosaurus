import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { d1Store } from "../src/d1.ts";
import { handle } from "../src/handlers.ts";
import {
  D1_MAX_ROW_BYTES,
  EXPIRY_MS,
  MAX_DRAWING_BYTES,
  PART_BYTES,
  SWEEP_LIMIT,
} from "../src/limits.ts";
import { memoryStore } from "../src/memory.ts";
import { SCENE, type Head, type StoreDb, type Write } from "../src/storeDb.ts";
import { sqliteD1, type D1Call } from "./sqliteD1.ts";

const TOKEN = "writetoken".repeat(5);
const OTHER = "othertoken".repeat(5);
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 20);

/** Bytes that change from one position to the next, so a part out of place shows. */
function bytes(size: number, seed = 1): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) out[i] = Math.imul(i + seed * 7919, 2654435761) >>> 24;
  return out;
}

const at = (path: string): string => `http://hydrawn.test/store/v1/drawings/${path}`;

interface Options {
  token?: string;
  rev?: number;
  now?: number;
}

const putScene = (
  db: StoreDb,
  id: string,
  body: Uint8Array<ArrayBuffer>,
  { token = TOKEN, rev = 0, now = T0 }: Options = {},
): Promise<Response> =>
  handle(
    new Request(at(id), {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "if-match": String(rev) },
      body,
    }),
    db,
    now,
  );

const putPicture = (
  db: StoreDb,
  id: string,
  pid: string,
  body: Uint8Array<ArrayBuffer>,
  { token = TOKEN, now = T0 }: Options = {},
): Promise<Response> =>
  handle(
    new Request(at(`${id}/pictures/${pid}`), {
      method: "PUT",
      headers: { authorization: `Bearer ${token}` },
      body,
    }),
    db,
    now,
  );

const get = (db: StoreDb, path: string): Promise<Response> => handle(new Request(at(path)), db, T0);

const read = async (response: Response): Promise<Uint8Array> =>
  new Uint8Array(await response.arrayBuffer());

async function headOf(db: StoreDb, id: string): Promise<Head> {
  const head = await db.head(id);
  if (head === null) throw new Error(`no head for ${id}`);
  return head;
}

interface Opened {
  db: StoreDb;
  /** The largest stored row, in bytes, where the store has rows. */
  largestRow?: () => number;
}

const stores: [string, () => Opened][] = [
  ["the in-memory fake", () => ({ db: memoryStore() })],
  [
    "D1, over SQLite",
    () => {
      const d1 = sqliteD1();
      const largestRow = (): number => {
        const row = d1.sqlite
          .prepare(
            "SELECT max(length(drawing_id) + length(item) + 8 + length(data)) AS size FROM parts",
          )
          .get();
        return Number(row?.size ?? 0);
      };
      return { db: d1Store(d1), largestRow };
    },
  ],
];

describe.each(stores)("the store, over %s", (_name, open) => {
  it("answers a stale if-match with 409, carrying the current rev", async () => {
    const { db } = open();
    expect((await putScene(db, "drawing1", bytes(100))).status).toBe(204);

    const behind = await putScene(db, "drawing1", bytes(100, 2), { rev: 0 });
    expect(behind.status).toBe(409);
    expect(behind.headers.get("etag")).toBe('"1"');
    const ahead = await putScene(db, "drawing1", bytes(100, 3), { rev: 7 });
    expect(ahead.status).toBe(409);
    expect(ahead.headers.get("etag")).toBe('"1"');

    expect(await read(await get(db, "drawing1"))).toEqual(bytes(100));
  });

  it("refuses a wrong token with 403, and takes the right one on a later write", async () => {
    const { db } = open();
    await putScene(db, "drawing1", bytes(100));

    expect((await putScene(db, "drawing1", bytes(100, 2), { rev: 1, token: OTHER })).status).toBe(
      403,
    );
    expect(
      (await putPicture(db, "drawing1", "picture1", bytes(100), { token: OTHER })).status,
    ).toBe(403);
    const right = await putScene(db, "drawing1", bytes(100, 3), { rev: 1 });
    expect(right.status).toBe(204);
    expect(right.headers.get("etag")).toBe('"2"');
    expect(await read(await get(db, "drawing1"))).toEqual(bytes(100, 3));

    // A picture can be a drawing's first write; it claims the drawing as much as a scene does.
    await putPicture(db, "drawing2", "picture1", bytes(100));
    expect((await putScene(db, "drawing2", bytes(100), { token: OTHER })).status).toBe(403);
  });

  it("round-trips a 5 MB body byte for byte, stored in parts under D1's row limit", async () => {
    const { db, largestRow } = open();
    const body = bytes(5_000_000);
    expect((await putScene(db, "drawing1", body)).status).toBe(204);

    const got = await read(await get(db, "drawing1"));
    expect(got.byteLength).toBe(body.byteLength);
    expect(Buffer.compare(got, body)).toBe(0);

    const stored = await db.scene("drawing1");
    expect(stored?.parts.length).toBe(Math.ceil(body.byteLength / PART_BYTES));
    for (const part of stored?.parts ?? []) expect(part.byteLength).toBeLessThanOrEqual(PART_BYTES);
    if (largestRow) expect(largestRow()).toBeLessThan(D1_MAX_ROW_BYTES);
  });

  it("answers 413 for a write that would take the drawing past the cap, its pictures counted", async () => {
    const { db } = open();
    const picture = MAX_DRAWING_BYTES - 1000;
    expect((await putPicture(db, "drawing1", "picture1", bytes(picture))).status).toBe(204);

    expect((await putScene(db, "drawing1", bytes(1001))).status).toBe(413);
    expect((await putPicture(db, "drawing1", "picture2", bytes(1001))).status).toBe(413);
    // Up to the cap exactly; a scene written again counts once, not twice.
    expect((await putScene(db, "drawing1", bytes(1000))).status).toBe(204);
    expect((await putScene(db, "drawing1", bytes(1000, 2), { rev: 1 })).status).toBe(204);
    // A body over the cap on its own.
    expect((await putScene(db, "drawing2", bytes(MAX_DRAWING_BYTES + 1))).status).toBe(413);
  });

  it("keeps a picture as first written: other bytes are a 409, the same bytes a 204", async () => {
    const { db } = open();
    expect((await putPicture(db, "drawing1", "picture1", bytes(3000))).status).toBe(204);

    expect((await putPicture(db, "drawing1", "picture1", bytes(3000, 2))).status).toBe(409);
    expect((await putPicture(db, "drawing1", "picture1", bytes(3000))).status).toBe(204);
    expect(await read(await get(db, "drawing1/pictures/picture1"))).toEqual(bytes(3000));
  });

  it("sweeps away drawings not written for over a year, only those, a few per write", async () => {
    const { db } = open();
    await putScene(db, "expired1", bytes(100), { now: T0 });
    await putScene(db, "expired2", bytes(100), { now: T0 + 1 });
    await putPicture(db, "expired3", "picture1", bytes(100), { now: T0 + 2 });
    await putScene(db, "recent01", bytes(100), { now: T0 + 2 * DAY });

    // A year and a day after the expired ones: the recent one is 364 days old.
    const later = T0 + EXPIRY_MS + DAY;
    expect((await putScene(db, "writer01", bytes(100), { now: later })).status).toBe(204);
    expect(SWEEP_LIMIT).toBe(2);
    expect((await get(db, "expired1")).status).toBe(404);
    expect((await get(db, "expired2")).status).toBe(404);
    expect((await get(db, "expired3/pictures/picture1")).status).toBe(200);

    expect((await putScene(db, "writer01", bytes(100), { rev: 1, now: later })).status).toBe(204);
    expect((await get(db, "expired3/pictures/picture1")).status).toBe(404);
    for (const id of ["expired1", "expired2", "expired3"]) expect(await db.head(id)).toBeNull();
    expect((await get(db, "recent01")).status).toBe(200);
  });

  it("answers 400 for an id or a picture id the contract's slug rule refuses", async () => {
    const { db } = open();
    const refused = ["Drawing1", "short", "drawing_1", "a".repeat(33), "drawing1/pictures/Pic001"];
    for (const path of refused) expect((await get(db, path)).status, path).toBe(400);
    expect((await putScene(db, "Drawing1", bytes(10))).status).toBe(400);
    expect((await putPicture(db, "drawing1", "pic", bytes(10))).status).toBe(400);
    expect(await db.head("Drawing1")).toBeNull();
    expect(await db.head("drawing1")).toBeNull();
  });

  it("lands nothing, sweep included, from a write decided on a head that has changed since", async () => {
    const { db } = open();
    await putScene(db, "expired1", bytes(100), { now: T0 });
    await putScene(db, "drawing1", bytes(100), { now: T0 + 2 * DAY });
    const seen = await headOf(db, "drawing1");
    await putPicture(db, "drawing1", "picture1", bytes(50), { now: T0 + 2 * DAY });

    const late: Write = {
      id: "drawing1",
      seen: seen.nonce,
      head: { ...seen, rev: 2, nonce: "late", bytes: 10, sceneBytes: 10 },
      writtenAt: T0 + 3 * DAY,
      item: SCENE,
      parts: [bytes(10, 9)],
      sweep: { before: T0 + DAY, limit: SWEEP_LIMIT },
    };
    expect(await db.write(late)).toBe(false);
    // A create loses the same way to a drawing that exists.
    expect(await db.write({ ...late, seen: null })).toBe(false);

    expect((await headOf(db, "drawing1")).rev).toBe(1);
    expect(await read(await get(db, "drawing1"))).toEqual(bytes(100));
    expect((await get(db, "expired1")).status).toBe(200);
  });
});

describe("the store on D1", () => {
  const writes = (calls: D1Call[]): D1Call[] =>
    calls.filter((call) => call.kind === "batch" || !/^\s*SELECT\b/i.test(call.statement.sql));

  it("writes a scene in one batch: the compare-and-swap, then each part and the sweep on its nonce", async () => {
    const d1 = sqliteD1();
    const db = d1Store(d1);
    await putScene(db, "drawing1", bytes(100));
    const before = await headOf(db, "drawing1");
    d1.calls.length = 0;

    expect((await putScene(db, "drawing1", bytes(3 * PART_BYTES), { rev: 1 })).status).toBe(204);
    const after = await headOf(db, "drawing1");

    const [batch, ...others] = writes(d1.calls);
    // The SQL only: the bound parts are megabytes of base64.
    expect(others.map((call) => (call.kind === "one" ? call.statement.sql : "a batch"))).toEqual(
      [],
    );
    if (batch?.kind !== "batch") throw new Error("the write was not a batch");
    const [cas, ...guarded] = batch.statements;
    expect(cas?.sql).toMatch(
      /^\s*UPDATE drawings SET[\s\S]*WHERE id = \?\d+ AND nonce = \?\d+\s*$/,
    );
    expect(cas?.values).toContain(before.nonce);
    expect(cas?.values).toContain(after.nonce);
    expect(guarded.filter(({ sql }) => /INSERT INTO parts/.test(sql))).toHaveLength(3);
    for (const { sql, values } of guarded) {
      expect(sql).toContain("EXISTS (SELECT 1 FROM drawings WHERE id = ?1 AND nonce = ?2)");
      expect(values.slice(0, 2)).toEqual(["drawing1", after.nonce]);
    }
  });
});
