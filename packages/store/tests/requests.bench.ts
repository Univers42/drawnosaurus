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

interface Rows {
  /** What `SELECT count(*) … FROM parts` answers: the item's upload so far. */
  item?: { parts: number; total: number; bytes: number };
  /** Whether part n is stored, with the bytes the request sends. */
  stored?: boolean;
}

function binding({ item, stored = false }: Rows): D1Database {
  const head = {
    rev: 1,
    proof,
    nonce: "nonce",
    bytes: 4 * PART_BYTES,
    scene_bytes: PART_BYTES,
    pictures: 1,
    staged_bytes: PART_BYTES,
    staged_at: Date.now(),
  };
  const rows = (sql: string): unknown[] => {
    if (/^\s*SELECT rev, proof/.test(sql)) return [head];
    if (/^\s*SELECT rev FROM/.test(sql)) return [{ rev: 1 }];
    if (/^\s*SELECT count/.test(sql)) return item ? [item] : [{ parts: 0 }];
    if (/^\s*SELECT total, data/.test(sql)) return stored ? [{ total: 3, data }] : [];
    return [];
  };
  // The Worker sends a statement and its values as JSON, and parses the JSON D1 answers,
  // which D1 makes: made once here, so only the Worker's share is timed.
  const answers = new Map<string, string>();
  const cross = <T>(sql: string, values: unknown[]) => {
    JSON.stringify({ sql, params: values });
    let answer = answers.get(sql);
    if (answer === undefined) {
      answer = JSON.stringify({ results: rows(sql), meta: { changes: 1 } });
      answers.set(sql, answer);
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

const cases: [string, Rows, () => Request][] = [
  ["PUT a scene of one part", {}, () => request("PUT", "", { "if-match": "1" })],
  [
    "PUT a staged part",
    { item: { parts: 1, total: 3, bytes: PART_BYTES } },
    () => request("PUT", "/staged/upload01/parts/1", { "if-match": "1", "x-parts": "3" }),
  ],
  [
    "PUT a staged part again, the same bytes",
    { item: { parts: 2, total: 3, bytes: 2 * PART_BYTES }, stored: true },
    () => request("PUT", "/staged/upload01/parts/1", { "if-match": "1", "x-parts": "3" }),
  ],
  [
    "PUT a picture part",
    { item: { parts: 1, total: 3, bytes: PART_BYTES } },
    () => request("PUT", "/pictures/picture1/parts/1", { "x-parts": "3" }),
  ],
  [
    "PUT a picture part again, the same bytes",
    { item: { parts: 2, total: 3, bytes: 2 * PART_BYTES }, stored: true },
    () => request("PUT", "/pictures/picture1/parts/1", { "x-parts": "3" }),
  ],
  [
    "POST a commit",
    { item: { parts: 3, total: 3, bytes: 3 * PART_BYTES } },
    () => request("POST", "/staged/upload01", { "if-match": "1" }, false),
  ],
  ["GET a scene part", { stored: true }, () => request("GET", "/parts/1", {}, false)],
  [
    "GET a picture part",
    { item: { parts: 3, total: 3, bytes: 3 * PART_BYTES }, stored: true },
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
