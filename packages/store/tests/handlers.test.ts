import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import { d1Store } from "../src/d1.ts";
import { handle } from "../src/handlers.ts";
import {
  D1_MAX_ROW_BYTES,
  EXPIRY_MS,
  MAX_DRAWING_BYTES,
  MAX_PARTS,
  PART_BYTES,
  STAGED_IDLE_MS,
  SWEEP_LIMIT,
} from "../src/limits.ts";
import { memoryStore } from "../src/memory.ts";
import { SCENE, type Head, type StoreDb, type Write } from "../src/storeDb.ts";
import { sqliteD1, type D1Call, type Statement } from "./sqliteD1.ts";

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

/** `body` cut the way a browser sends it: whole parts, and the rest last. */
function split(body: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>[] {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  for (let at = 0; at < body.byteLength; at += PART_BYTES) {
    parts.push(body.subarray(at, at + PART_BYTES));
  }
  return parts;
}

const at = (path: string): string => `http://hydrawn.test/store/v1/drawings/${path}`;

interface Options {
  token?: string;
  rev?: number | string;
  parts?: number | string;
  now?: number;
}

/** Every request the tests sent and what came back, by body size. */
const traffic: { request: string; sent: number; received: number }[] = [];

async function send(
  db: StoreDb,
  method: string,
  path: string,
  { token = TOKEN, rev, parts, now = T0 }: Options = {},
  body: Uint8Array<ArrayBuffer> | null = null,
): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (rev !== undefined) headers["if-match"] = String(rev);
  if (parts !== undefined) headers["x-parts"] = String(parts);
  const response = await handle(new Request(at(path), { method, headers, body }), db, now);
  traffic.push({
    request: `${method} ${path}`,
    sent: body?.byteLength ?? 0,
    received: (await response.clone().arrayBuffer()).byteLength,
  });
  return response;
}

const get = (db: StoreDb, path: string, now = T0): Promise<Response> =>
  send(db, "GET", path, { now });

/** Where a picture of more than one part is sent: an upload of its own, under an id. */
const uploading = (picture: string, uid = "upload01"): string => `${picture}/uploads/${uid}`;

const putScene = (
  db: StoreDb,
  id: string,
  body: Uint8Array<ArrayBuffer>,
  { rev = 0, ...options }: Options = {},
): Promise<Response> => send(db, "PUT", id, { rev, ...options }, body);

/** A picture of one part, sent without saying how many parts it has. */
const putPicture = (
  db: StoreDb,
  id: string,
  pid: string,
  body: Uint8Array<ArrayBuffer>,
  options: Options = {},
): Promise<Response> => send(db, "PUT", `${id}/pictures/${pid}`, options, body);

const putPart = (
  db: StoreDb,
  path: string,
  n: number,
  body: Uint8Array<ArrayBuffer>,
  options: Options,
): Promise<Response> => send(db, "PUT", `${path}/parts/${n}`, options, body);

/** Sends `body` to `path` one part per request, in order; the statuses, in order. */
async function upload(
  db: StoreDb,
  path: string,
  body: Uint8Array<ArrayBuffer>,
  options: Options = {},
): Promise<number[]> {
  const parts = split(body);
  const statuses: number[] = [];
  for (const [n, part] of parts.entries()) {
    statuses.push((await putPart(db, path, n, part, { ...options, parts: parts.length })).status);
  }
  return statuses;
}

const commit = (db: StoreDb, id: string, sid: string, options: Options): Promise<Response> =>
  send(db, "POST", `${id}/staged/${sid}`, options);

const read = async (response: Response): Promise<Uint8Array> =>
  new Uint8Array(await response.arrayBuffer());

/** Reads `path` part by part, as a browser does: part 0, then the rest its x-parts names. */
async function readWhole(
  db: StoreDb,
  path: string,
): Promise<{ status: number; bytes: Buffer; etags: (string | null)[]; total: number }> {
  const first = await get(db, path);
  const total = Number(first.headers.get("x-parts"));
  const responses = [first];
  for (let n = 1; first.status === 200 && n < total; n++) {
    responses.push(await get(db, `${path}/parts/${n}`));
  }
  return {
    status: responses.find((response) => response.status !== 200)?.status ?? 200,
    bytes: Buffer.concat(await Promise.all(responses.map(read))),
    etags: responses.map((response) => response.headers.get("etag")),
    total,
  };
}

async function headOf(db: StoreDb, id: string): Promise<Head> {
  const head = await db.head(id);
  if (head === null) throw new Error(`no head for ${id}`);
  return head;
}

interface Opened {
  db: StoreDb;
  /** The largest stored row, in bytes, where the store has rows. */
  largestRow?: () => number;
  /** How many staged parts are stored, where the store has rows. */
  stagedRows?: () => number;
  /** How many parts of unfinished picture uploads are stored, where the store has rows. */
  pendingRows?: () => number;
}

const stores: [string, () => Opened][] = [
  ["the in-memory fake", () => ({ db: memoryStore() })],
  [
    "D1, over SQLite",
    () => {
      const d1 = sqliteD1();
      const count = (sql: string): number => Number(d1.sqlite.prepare(sql).get()?.size ?? 0);
      return {
        db: d1Store(d1),
        largestRow: () =>
          count(
            "SELECT max(length(drawing_id) + length(item) + 8 + length(data)) AS size FROM parts",
          ),
        stagedRows: () => count("SELECT count(*) AS size FROM parts WHERE item GLOB '@*'"),
        pendingRows: () => count("SELECT count(*) AS size FROM parts WHERE item GLOB '#*'"),
      };
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

  it("refuses a wrong token with 403 on a part upload and on a commit, storing nothing", async () => {
    const { db } = open();
    await putScene(db, "drawing1", bytes(100));

    const picture = split(bytes(PART_BYTES + 10));
    expect(
      (
        await putPart(db, uploading("drawing1/pictures/picture1"), 0, picture[0]!, {
          token: OTHER,
          parts: 2,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await putPart(db, "drawing1/staged/upload01", 0, picture[0]!, {
          token: OTHER,
          rev: 1,
          parts: 2,
        })
      ).status,
    ).toBe(403);
    expect(
      await upload(db, "drawing1/staged/upload02", bytes(PART_BYTES + 10), { rev: 1 }),
    ).toEqual([204, 204]);
    expect((await commit(db, "drawing1", "upload02", { rev: 1, token: OTHER })).status).toBe(403);

    const head = await headOf(db, "drawing1");
    expect(head.rev).toBe(1);
    expect(head.bytes).toBe(100 + PART_BYTES + 10);
    expect((await get(db, "drawing1/pictures/picture1")).status).toBe(404);
  });

  it("round-trips a 4 MB picture one part per request, readable once all its parts are in", async () => {
    const { db, largestRow } = open();
    const picture = bytes(4_000_000);
    const parts = split(picture);
    expect(parts).toHaveLength(4);
    // One request does not carry it whole.
    const whole = await putPicture(db, "drawing1", "picture1", picture);
    expect(whole.status).toBe(413);
    expect(await whole.json()).toMatchObject({ error: { code: "part_too_large" } });

    traffic.length = 0;
    const path = "drawing1/pictures/picture1";
    for (const n of [0, 1, 2]) {
      expect((await putPart(db, uploading(path), n, parts[n]!, { parts: 4 })).status).toBe(204);
    }
    expect((await get(db, path)).status).toBe(404);
    expect((await get(db, `${path}/parts/0`)).status).toBe(404);
    expect((await putPart(db, uploading(path), 3, parts[3]!, { parts: 4 })).status).toBe(204);

    const got = await readWhole(db, path);
    expect(got.status).toBe(200);
    expect(got.total).toBe(4);
    expect(Buffer.compare(got.bytes, picture)).toBe(0);
    expect(traffic.filter(({ request }) => request.startsWith("PUT"))).toHaveLength(4);
    expect(traffic.filter(({ request }) => request.startsWith("GET"))).toHaveLength(6);
    for (const exchange of traffic) {
      expect(Math.max(exchange.sent, exchange.received), exchange.request).toBeLessThanOrEqual(
        PART_BYTES,
      );
    }
    expect((await headOf(db, "drawing1")).bytes).toBe(picture.byteLength);
    if (largestRow) expect(largestRow()).toBeLessThan(D1_MAX_ROW_BYTES);
  });

  it("makes a staged scene current only on its commit, read back one part per request", async () => {
    const { db } = open();
    await putScene(db, "drawing1", bytes(100));
    const scene = bytes(2 * PART_BYTES + 7, 2);
    // Over one part, a scene is not sent whole.
    expect((await putScene(db, "drawing1", scene, { rev: 1 })).status).toBe(413);

    expect(await upload(db, "drawing1/staged/upload01", scene, { rev: 1 })).toEqual([
      204, 204, 204,
    ]);
    const before = await readWhole(db, "drawing1");
    expect(before.etags).toEqual(['"1"']);
    expect(Buffer.compare(before.bytes, bytes(100))).toBe(0);

    const committed = await commit(db, "drawing1", "upload01", { rev: 1 });
    expect(committed.status).toBe(204);
    expect(committed.headers.get("etag")).toBe('"2"');
    const after = await readWhole(db, "drawing1");
    expect(after.total).toBe(3);
    expect(after.etags).toEqual(['"2"', '"2"', '"2"']);
    expect(Buffer.compare(after.bytes, scene)).toBe(0);
    expect((await headOf(db, "drawing1")).bytes).toBe(scene.byteLength);

    // A one-part scene replaces it whole, no tail of the old parts left.
    expect((await putScene(db, "drawing1", bytes(50, 3), { rev: 2 })).status).toBe(204);
    const small = await readWhole(db, "drawing1");
    expect(small.total).toBe(1);
    expect(Buffer.compare(small.bytes, bytes(50, 3))).toBe(0);
    expect((await get(db, "drawing1/parts/1")).status).toBe(404);
  });

  it("answers a stale commit with 409 and the current rev, changing nothing", async () => {
    const { db } = open();
    await putScene(db, "drawing1", bytes(100));
    await upload(db, "drawing1/staged/upload01", bytes(PART_BYTES + 1, 2), { rev: 1 });

    for (const rev of [0, 2]) {
      const stale = await commit(db, "drawing1", "upload01", { rev });
      expect(stale.status).toBe(409);
      expect(stale.headers.get("etag")).toBe('"1"');
    }
    expect(Buffer.compare((await readWhole(db, "drawing1")).bytes, bytes(100))).toBe(0);
    // The upload still stands, and publishes at the right rev.
    expect((await commit(db, "drawing1", "upload01", { rev: 1 })).status).toBe(204);
    // Staging on a stale rev is refused at its first part.
    const late = await putPart(db, "drawing1/staged/upload02", 0, bytes(PART_BYTES), {
      rev: 1,
      parts: 2,
    });
    expect(late.status).toBe(409);
    expect(late.headers.get("etag")).toBe('"2"');
  });

  it("sweeps the staged parts of a write that lost the race: the cap stops counting them", async () => {
    const { db, stagedRows } = open();
    await putScene(db, "drawing1", bytes(100));
    expect(
      await upload(db, "drawing1/staged/uploada", bytes(PART_BYTES + 1, 2), { rev: 1 }),
    ).toEqual([204, 204]);
    // Staged parts count against the cap as they land.
    expect((await headOf(db, "drawing1")).bytes).toBe(100 + PART_BYTES + 1);
    expect(
      await upload(db, "drawing1/staged/uploadb", bytes(PART_BYTES + 2, 3), { rev: 1 }),
    ).toEqual([204, 204]);
    expect((await commit(db, "drawing1", "uploadb", { rev: 1 })).status).toBe(204);

    expect((await headOf(db, "drawing1")).bytes).toBe(PART_BYTES + 2);
    expect((await commit(db, "drawing1", "uploada", { rev: 1 })).status).toBe(409);
    const late = await commit(db, "drawing1", "uploada", { rev: 2 });
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ error: { code: "staged_incomplete" } });
    if (stagedRows) expect(stagedRows()).toBe(0);

    // A one-part scene write publishes as much as a commit does, and sweeps the same way.
    await upload(db, "drawing1/staged/uploadc", bytes(PART_BYTES + 3, 4), { rev: 2 });
    expect((await putScene(db, "drawing1", bytes(10), { rev: 2 })).status).toBe(204);
    expect((await headOf(db, "drawing1")).bytes).toBe(10);
    if (stagedRows) expect(stagedRows()).toBe(0);
  });

  it("sweeps an abandoned staged upload at the first write after staging idles out", async () => {
    const { db, stagedRows } = open();
    await putScene(db, "drawing1", bytes(100));
    await upload(db, "drawing1/staged/upload01", bytes(3 * PART_BYTES, 2), { rev: 1 });

    // 3 MiB staged beside an 8 MiB picture is over the cap: the picture's last part is refused.
    const picture = bytes(8 * PART_BYTES, 4);
    const path = "drawing1/pictures/picture1";
    expect(await upload(db, uploading(path), picture, { now: T0 + 60_000 })).toEqual([
      204, 204, 204, 204, 204, 204, 204, 413,
    ]);
    // Once staging has idled out, the staged upload is gone and the part lands.
    const later = T0 + STAGED_IDLE_MS + 1;
    const last = split(picture)[7]!;
    expect((await putPart(db, uploading(path), 7, last, { parts: 8, now: later })).status).toBe(
      204,
    );

    expect((await headOf(db, "drawing1")).bytes).toBe(100 + picture.byteLength);
    expect((await commit(db, "drawing1", "upload01", { rev: 1, now: later })).status).toBe(409);
    expect(Buffer.compare((await readWhole(db, path)).bytes, picture)).toBe(0);
    if (stagedRows) expect(stagedRows()).toBe(0);
  });

  it("replaces a 6 MiB staged scene with another: the cap leaves out the scene a commit replaces", async () => {
    const { db } = open();
    await putScene(db, "drawing1", bytes(100));
    const second = bytes(6 * PART_BYTES, 3);
    const six = Array<number>(6).fill(204);
    expect(
      await upload(db, "drawing1/staged/uploada", bytes(6 * PART_BYTES, 2), { rev: 1 }),
    ).toEqual(six);
    expect((await commit(db, "drawing1", "uploada", { rev: 1 })).status).toBe(204);
    expect(await upload(db, "drawing1/staged/uploadb", second, { rev: 2 })).toEqual(six);
    expect((await commit(db, "drawing1", "uploadb", { rev: 2 })).status).toBe(204);
    expect(Buffer.compare((await readWhole(db, "drawing1")).bytes, second)).toBe(0);

    // Staging still fits beside the pictures: 4 MiB of them leave 6 MiB to stage.
    const picture = bytes(4 * PART_BYTES, 4);
    expect(await upload(db, uploading("drawing1/pictures/picture1"), picture)).toEqual([
      204, 204, 204, 204,
    ]);
    expect(
      await upload(db, "drawing1/staged/uploadc", bytes(7 * PART_BYTES, 5), { rev: 3 }),
    ).toEqual([...six, 413]);
    // A one-part scene replaces the 6 MiB scene beside them; the staged parts go with it.
    expect((await putScene(db, "drawing1", bytes(PART_BYTES, 6), { rev: 3 })).status).toBe(204);
    expect((await headOf(db, "drawing1")).bytes).toBe(5 * PART_BYTES);
  });

  it("completes a retried picture upload whose bytes differ; the interrupted one is swept once idle", async () => {
    const { db, pendingRows } = open();
    await putScene(db, "drawing1", bytes(100));
    const picture = "drawing1/pictures/picture1";
    // Sealing again draws a fresh IV, so a retry of the same picture sends other bytes.
    const [first, second] = split(bytes(3 * PART_BYTES, 2));
    const resealed = bytes(3 * PART_BYTES, 3);
    expect((await putPart(db, uploading(picture, "uploada"), 0, first!, { parts: 3 })).status).toBe(
      204,
    );
    expect(
      (await putPart(db, uploading(picture, "uploada"), 1, second!, { parts: 3 })).status,
    ).toBe(204);
    expect((await get(db, picture)).status).toBe(404);

    const retried = T0 + 60_000;
    expect(await upload(db, uploading(picture, "uploadb"), resealed, { now: retried })).toEqual([
      204, 204, 204,
    ]);
    expect(Buffer.compare((await readWhole(db, picture)).bytes, resealed)).toBe(0);
    // Until it idles out, the interrupted upload counts against the cap.
    expect((await headOf(db, "drawing1")).bytes).toBe(100 + 5 * PART_BYTES);

    const later = retried + STAGED_IDLE_MS + 1;
    expect((await putScene(db, "drawing1", bytes(100, 4), { rev: 1, now: later })).status).toBe(
      204,
    );
    const head = await headOf(db, "drawing1");
    expect(head.bytes).toBe(100 + 3 * PART_BYTES);
    expect(head.pictures).toBe(1);
    expect(
      (await putPart(db, uploading(picture, "uploada"), 2, first!, { parts: 3, now: later }))
        .status,
    ).toBe(409);
    if (pendingRows) expect(pendingRows()).toBe(0);
  });

  it("keeps the first of two uploads of one picture to finish, mixing in none of the other", async () => {
    const { db } = open();
    const picture = "drawing1/pictures/picture1";
    const a = split(bytes(2 * PART_BYTES + 1000, 2));
    const b = split(bytes(2 * PART_BYTES + 1000, 3));
    for (const n of [0, 1]) {
      expect(
        (await putPart(db, uploading(picture, "uploada"), n, a[n]!, { parts: 3 })).status,
      ).toBe(204);
      expect(
        (await putPart(db, uploading(picture, "uploadb"), n, b[n]!, { parts: 3 })).status,
      ).toBe(204);
    }
    expect((await putPart(db, uploading(picture, "uploada"), 2, a[2]!, { parts: 3 })).status).toBe(
      204,
    );
    expect((await putPart(db, uploading(picture, "uploadb"), 2, b[2]!, { parts: 3 })).status).toBe(
      409,
    );
    expect(
      Buffer.compare((await readWhole(db, picture)).bytes, bytes(2 * PART_BYTES + 1000, 2)),
    ).toBe(0);
    expect((await headOf(db, "drawing1")).pictures).toBe(1);
  });

  it("checks the write proof before it reads the body", async () => {
    const { db } = open();
    await putScene(db, "drawing1", bytes(100));
    const request = new Request(at("drawing1"), {
      method: "PUT",
      headers: { authorization: `Bearer ${OTHER}`, "if-match": "1" },
      body: bytes(100, 2),
    });
    expect((await handle(request, db, T0)).status).toBe(403);
    expect(request.bodyUsed).toBe(false);
    // So a stranger's body over one part is a 403, never read far enough to be a 413.
    expect(
      (await putScene(db, "drawing1", bytes(PART_BYTES + 1), { rev: 1, token: OTHER })).status,
    ).toBe(403);
  });

  it("answers 404 for a drawing not written for a year, before any sweep deletes it", async () => {
    const { db } = open();
    await putScene(db, "drawing1", bytes(100), { now: T0 });
    await putPicture(db, "drawing1", "picture1", bytes(100), { now: T0 });
    for (const path of ["drawing1", "drawing1/parts/0", "drawing1/pictures/picture1"]) {
      expect((await get(db, path, T0 + EXPIRY_MS)).status, path).toBe(200);
      expect((await get(db, path, T0 + EXPIRY_MS + 1)).status, path).toBe(404);
    }
    expect(await db.head("drawing1")).not.toBeNull();
  });

  it("answers 400 for a part number, an if-match or an x-parts that is not a canonical decimal", async () => {
    const { db } = open();
    await putScene(db, "drawing1", bytes(100));
    for (const n of ["01", "00", "-1", "+1", "1e0", "1.0", "0x1", "one"]) {
      expect((await get(db, `drawing1/parts/${n}`)).status, n).toBe(400);
    }
    for (const rev of ["01", '"01"', "+1", "-0", "1e0", "1.0", '"1', "0x1"]) {
      expect((await putScene(db, "drawing1", bytes(10), { rev })).status, rev).toBe(400);
    }
    const staged = "drawing1/staged/upload01";
    for (const parts of ["02", "+2", "2.0"]) {
      expect(
        (await putPart(db, staged, 0, bytes(PART_BYTES), { rev: 1, parts })).status,
        parts,
      ).toBe(400);
    }
    expect((await headOf(db, "drawing1")).rev).toBe(1);
    expect((await putScene(db, "drawing1", bytes(10), { rev: '"1"' })).status).toBe(204);
    expect((await putScene(db, "drawing1", bytes(10), { rev: 2 })).status).toBe(204);
  });

  it("answers 413 for a write that would take the drawing past the cap, its pictures counted", async () => {
    const { db } = open();
    const picture = MAX_DRAWING_BYTES - 1000;
    expect(await upload(db, uploading("drawing1/pictures/picture1"), bytes(picture))).toEqual(
      Array<number>(10).fill(204),
    );

    expect((await putScene(db, "drawing1", bytes(1001))).status).toBe(413);
    expect((await putPicture(db, "drawing1", "picture2", bytes(1001))).status).toBe(413);
    // Up to the cap exactly; a scene written again counts once, not twice.
    expect((await putScene(db, "drawing1", bytes(1000))).status).toBe(204);
    expect((await putScene(db, "drawing1", bytes(1000, 2), { rev: 1 })).status).toBe(204);
    // A request over one part, whatever the drawing holds.
    const over = await putScene(db, "drawing2", bytes(PART_BYTES + 1));
    expect(over.status).toBe(413);
    expect(await over.json()).toMatchObject({ error: { code: "part_too_large" } });
  });

  it("keeps a picture as first written: other bytes are a 409, the same bytes a 204", async () => {
    const { db } = open();
    expect((await putPicture(db, "drawing1", "picture1", bytes(3000))).status).toBe(204);

    expect((await putPicture(db, "drawing1", "picture1", bytes(3000, 2))).status).toBe(409);
    expect((await putPicture(db, "drawing1", "picture1", bytes(3000))).status).toBe(204);
    expect(await read(await get(db, "drawing1/pictures/picture1"))).toEqual(bytes(3000));

    // In an upload, a part sent again with the same bytes is a 204, with others a 409.
    const path = uploading("drawing1/pictures/picture2");
    const [first, rest] = split(bytes(PART_BYTES + 5));
    expect((await putPart(db, path, 0, first!, { parts: 2 })).status).toBe(204);
    expect((await putPart(db, path, 0, first!, { parts: 2 })).status).toBe(204);
    expect((await putPart(db, path, 0, bytes(PART_BYTES, 9), { parts: 2 })).status).toBe(409);
    expect((await putPart(db, path, 0, first!, { parts: 3 })).status).toBe(409);
    expect((await putPart(db, path, 1, rest!, { parts: 2 })).status).toBe(204);
    // Complete, the picture is write-once: its parts again are 204s, any other upload a 409.
    expect((await putPart(db, path, 1, rest!, { parts: 2 })).status).toBe(204);
    expect((await putPart(db, path, 1, bytes(5, 9), { parts: 2 })).status).toBe(409);
    const other = uploading("drawing1/pictures/picture2", "upload02");
    expect((await putPart(db, other, 0, bytes(PART_BYTES, 9), { parts: 2 })).status).toBe(409);
    expect((await putPicture(db, "drawing1", "picture2", bytes(5))).status).toBe(409);
    expect((await headOf(db, "drawing1")).bytes).toBe(3000 + PART_BYTES + 5);
    expect((await headOf(db, "drawing1")).pictures).toBe(2);
  });

  it("takes an upload's parts in order, each but the last a whole part", async () => {
    const { db } = open();
    const path = uploading("drawing1/pictures/picture1");
    expect((await putPart(db, path, 1, bytes(10), { parts: 2 })).status).toBe(409);
    expect((await putPart(db, path, 0, bytes(PART_BYTES - 1), { parts: 2 })).status).toBe(400);
    expect((await putPart(db, path, 2, bytes(10), { parts: 2 })).status).toBe(400);
    expect((await putPart(db, path, 0, bytes(10), { parts: MAX_PARTS + 1 })).status).toBe(400);
    expect((await putPart(db, path, 0, bytes(10), { parts: 0 })).status).toBe(400);
    // A picture of one part is a plain PUT, and a plain PUT holds one part.
    expect((await putPart(db, path, 0, bytes(10), { parts: 1 })).status).toBe(400);
    expect((await putPicture(db, "drawing1", "picture1", bytes(10), { parts: 2 })).status).toBe(
      400,
    );
    // A scene of one part is a plain PUT: staging one would only leave rows behind.
    const staged = "drawing1/staged/upload01";
    expect((await putPart(db, staged, 0, bytes(10), { rev: 0, parts: 1 })).status).toBe(400);
    expect((await putPart(db, staged, 0, bytes(PART_BYTES), { rev: 0 })).status).toBe(400);
    expect(await db.head("drawing1")).toBeNull();
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

  it("answers 400 for an id, a picture id or an upload id the contract's slug rule refuses", async () => {
    const { db } = open();
    const refused = ["Drawing1", "short", "drawing_1", "a".repeat(33), "drawing1/pictures/Pic001"];
    for (const path of refused) expect((await get(db, path)).status, path).toBe(400);
    expect((await putScene(db, "Drawing1", bytes(10))).status).toBe(400);
    expect((await putPicture(db, "drawing1", "pic", bytes(10))).status).toBe(400);
    expect(
      (await putPart(db, "drawing1/staged/Upload01", 0, bytes(PART_BYTES), { rev: 0, parts: 2 }))
        .status,
    ).toBe(400);
    expect((await commit(db, "drawing1", "up", { rev: 0 })).status).toBe(400);
    expect(
      (
        await putPart(
          db,
          uploading("drawing1/pictures/picture1", "Up_load1"),
          0,
          bytes(PART_BYTES),
          {
            parts: 2,
          },
        )
      ).status,
    ).toBe(400);
    expect(await db.head("Drawing1")).toBeNull();
    expect(await db.head("drawing1")).toBeNull();
  });

  it("answers 405 with the route's methods for any other, whatever its name", async () => {
    const { db } = open();
    const cases: [string, string, string][] = [
      ["DELETE", "drawing1", "GET, PUT"],
      ["constructor", "drawing1", "GET, PUT"],
      ["PUT", "drawing1/parts/1", "GET"],
      ["GET", "drawing1/staged/upload01", "POST"],
      ["toString", "drawing1/staged/upload01/parts/0", "PUT"],
      ["PUT", "drawing1/pictures/picture1/parts/0", "GET"],
      ["GET", "drawing1/pictures/picture1/uploads/upload01/parts/0", "PUT"],
    ];
    for (const [method, path, allow] of cases) {
      const response = await send(db, method, path, { rev: 0 });
      expect(response.status, `${method} ${path}`).toBe(405);
      expect(response.headers.get("allow")).toBe(allow);
    }
  });

  it("decides a write again when another lands between its read and its own write", async () => {
    const { db } = open();
    await putScene(db, "drawing1", bytes(100));
    let raced = false;
    const racing: StoreDb = {
      ...db,
      head: async (id) => {
        const head = await db.head(id);
        if (!raced) {
          raced = true;
          await putPicture(db, "drawing1", "picture1", bytes(50));
        }
        return head;
      },
    };

    const response = await putScene(racing, "drawing1", bytes(100, 2), { rev: 1 });
    expect(response.status).toBe(204);
    expect(response.headers.get("etag")).toBe('"2"');
    expect(await read(await get(db, "drawing1/pictures/picture1"))).toEqual(bytes(50));
    expect((await headOf(db, "drawing1")).bytes).toBe(150);
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
      changes: [
        { kind: "put", item: SCENE, n: 0, total: 1, bytes: bytes(10, 9) },
        { kind: "trim", item: SCENE, from: 1 },
        { kind: "dropStaged" },
      ],
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

describe("the store, when its database refuses", () => {
  it("answers 503 store_unavailable, an error the browser can show", async () => {
    const spent = (): Promise<never> =>
      Promise.reject(new Error("D1_ERROR: Exceeded maximum daily rows written"));
    const db: StoreDb = { head: spent, item: spent, part: spent, read: spent, write: spent };
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    for (const response of [await get(db, "drawing1"), await putScene(db, "drawing1", bytes(10))]) {
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: { code: "store_unavailable" } });
    }
    expect(logged).toHaveBeenCalledTimes(2);
    logged.mockRestore();
  });
});

describe("the store on D1", () => {
  const writes = (calls: D1Call[]): D1Call[] =>
    calls.filter((call) => call.kind === "batch" || !/^\s*SELECT\b/i.test(call.statement.sql));

  /** The write's one batch: its compare-and-swap, then the statements guarded on its nonce. */
  async function batchOf(
    d1: ReturnType<typeof sqliteD1>,
    write: () => Promise<Response>,
  ): Promise<Statement[]> {
    const db = d1Store(d1);
    const before = await headOf(db, "drawing1");
    d1.calls.length = 0;
    expect((await write()).status).toBe(204);
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
    for (const { sql, values } of guarded) {
      expect(sql).toContain("EXISTS (SELECT 1 FROM drawings WHERE id = ?1 AND nonce = ?2)");
      expect(values.slice(0, 2)).toEqual(["drawing1", after.nonce]);
    }
    return batch.statements;
  }

  it("writes a one-part scene in one batch: the compare-and-swap, then its part on its nonce", async () => {
    const d1 = sqliteD1();
    const db = d1Store(d1);
    await putScene(db, "drawing1", bytes(100));

    const statements = await batchOf(d1, () =>
      putScene(db, "drawing1", bytes(PART_BYTES), { rev: 1 }),
    );
    expect(statements.filter(({ sql }) => /INSERT INTO parts/.test(sql))).toHaveLength(1);
  });

  it("publishes a staged scene in one batch that carries no part", async () => {
    const d1 = sqliteD1();
    const db = d1Store(d1);
    await putScene(db, "drawing1", bytes(100));
    await upload(db, "drawing1/staged/upload01", bytes(2 * PART_BYTES + 1), { rev: 1 });

    const statements = await batchOf(d1, () => commit(db, "drawing1", "upload01", { rev: 1 }));
    expect(statements.filter(({ sql }) => /INSERT INTO parts/.test(sql))).toEqual([]);
    const bound = statements.flatMap(({ values }) => values.map((v) => String(v)));
    expect(Math.max(...bound.map((value) => value.length))).toBeLessThan(100);
  });
});
