import { bench, describe } from "vitest";
import { d1Store, encodePart, type D1Database, type D1PreparedStatement } from "../src/d1.ts";
import { handle } from "../src/handlers.ts";
import { PART_BYTES } from "../src/limits.ts";

/*
 * What each kind of request costs in CPU at its worst: a whole part, the most one request
 * carries (Ruling 27), and every read the path makes. The handler runs as it does on
 * Cloudflare, over a stand-in for the D1 binding that does the binding's share on the
 * Worker — JSON-encode what it sends, JSON-decode what comes back — and answers from rows
 * set here, so D1's own work, which is not the Worker's CPU, is left out. The bench's mean
 * is milliseconds per request:
 *
 *   pnpm --filter @drawnosaurus/store exec vitest bench --run
 */

const TOKEN = "writetoken".repeat(5);
const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN));
const proof = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
const part = new Uint8Array(PART_BYTES).map((_, i) => Math.imul(i, 2654435761) >>> 24);
const data = encodePart(part);

type Upload = { parts: number; total: number; bytes: number };

interface Rows {
  /** What `SELECT count(*) … FROM parts` answers for each item: its upload so far. */
  items?: Record<string, Upload>;
  /** Whether part n is stored, with the bytes the request sends. */
  stored?: boolean;
}

function binding({ items = {}, stored = false }: Rows): D1Database {
  // A drawing with a scene, a picture, a staged scene and a picture being sent, all recent.
  const head = {
    rev: 1,
    proof,
    nonce: "nonce",
    bytes: 7 * PART_BYTES,
    scene_bytes: PART_BYTES,
    pictures: 1,
    staged_bytes: 3 * PART_BYTES,
    staged_at: Date.now(),
    pending_bytes: 2 * PART_BYTES,
    pending_at: Date.now(),
  };
  const rows = (sql: string, values: unknown[]): unknown[] => {
    if (/^\s*SELECT rev, proof/.test(sql)) return [head];
    if (/^\s*SELECT rev, written_at/.test(sql)) return [{ rev: 1, written_at: Date.now() }];
    if (/^\s*SELECT count/.test(sql)) return [items[String(values[1])] ?? { parts: 0 }];
    if (/^\s*SELECT total, data/.test(sql)) return stored ? [{ total: 3, data }] : [];
    return [];
  };
  // The Worker sends a statement and its values as JSON, and parses the JSON D1 answers,
  // which D1 makes: made once here, so only the Worker's share is timed.
  const answers = new Map<string, string>();
  const cross = <T>(sql: string, values: unknown[]) => {
    JSON.stringify({ sql, params: values });
    const key = /^\s*SELECT/.test(sql) ? `${sql}${JSON.stringify(values)}` : sql;
    let answer = answers.get(key);
    if (answer === undefined) {
      answer = JSON.stringify({ results: rows(sql, values), meta: { changes: 1 } });
      answers.set(key, answer);
    }
    return JSON.parse(answer) as { results: T[]; meta: { changes: number } };
  };
  type Bound = D1PreparedStatement & { sql: string; values: unknown[] };
  const statement = (sql: string, values: unknown[]): Bound => ({
    sql,
    values,
    bind: (...next) => statement(sql, next),
    first: async <T>() => cross<T>(sql, values).results[0] ?? null,
    all: async <T>() => cross<T>(sql, values),
  });
  return {
    prepare: (sql) => statement(sql, []),
    batch: async <T>(statements: D1PreparedStatement[]) =>
      (statements as Bound[]).map(({ sql, values }) => cross<T>(sql, values)),
  };
}

const request = (method: string, path: string, headers: Record<string, string>, body = true) =>
  new Request(`http://hydrawn.test/store/v1/drawings/drawing1${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, ...headers },
    body: body ? part : null,
  });

const sent = (parts: number): Upload => ({ parts, total: 3, bytes: parts * PART_BYTES });
const upload = "/pictures/picture1/uploads/upload01/parts";

const cases: [string, Rows, () => Request][] = [
  ["PUT a scene of one part", {}, () => request("PUT", "", { "if-match": "1" })],
  [
    "PUT a staged part",
    { items: { "@upload01": sent(1) } },
    () => request("PUT", "/staged/upload01/parts/1", { "if-match": "1", "x-parts": "3" }),
  ],
  [
    "PUT a staged part again, the same bytes",
    { items: { "@upload01": sent(2) }, stored: true },
    () => request("PUT", "/staged/upload01/parts/1", { "if-match": "1", "x-parts": "3" }),
  ],
  [
    "PUT a picture's part",
    { items: { "#picture1:upload01": sent(1) } },
    () => request("PUT", `${upload}/1`, { "x-parts": "3" }),
  ],
  [
    "PUT a picture's last part, which completes it",
    { items: { "#picture1:upload01": sent(2) } },
    () => request("PUT", `${upload}/2`, { "x-parts": "3" }),
  ],
  [
    "PUT a picture's part again, the same bytes",
    { items: { "#picture1:upload01": sent(2) }, stored: true },
    () => request("PUT", `${upload}/1`, { "x-parts": "3" }),
  ],
  [
    "PUT a part of a complete picture again, the same bytes",
    { items: { picture1: sent(3) }, stored: true },
    () => request("PUT", `${upload}/1`, { "x-parts": "3" }),
  ],
  [
    "POST a commit",
    { items: { "@upload01": sent(3) } },
    () => request("POST", "/staged/upload01", { "if-match": "1" }, false),
  ],
  [
    "GET a scene part",
    { items: { "": sent(3) }, stored: true },
    () => request("GET", "/parts/1", {}, false),
  ],
  [
    "GET a picture part",
    { items: { picture1: sent(3) }, stored: true },
    () => request("GET", "/pictures/picture1/parts/1", {}, false),
  ],
];

describe("one request, at its worst", () => {
  for (const [name, rows, make] of cases) {
    const db = d1Store(binding(rows));
    bench(name, async () => {
      const response = await handle(make(), db);
      if (response.status >= 300) throw new Error(`${name}: ${response.status}`);
    });
  }
});
