/**
 * The store's ceilings, each set from a Cloudflare free-plan limit read on 2026-10-20. Every
 * figure below is a claim about that day.
 */

/**
 * D1 refuses a row over 2,000,000 bytes ("Maximum string, BLOB or table row size",
 * https://developers.cloudflare.com/d1/platform/limits/). The tests hold every stored part
 * under it.
 */
export const D1_MAX_ROW_BYTES = 2_000_000;

/**
 * What one part holds, in bytes before encoding: the most one request carries, either way
 * (Ruling 27), and the most one row stores. A part is stored as base64 text (`d1.ts` says
 * why), a third larger: 1 MiB becomes 1,398,104 characters, which leaves about 600 KB under
 * the row limit for the key and the row's own overhead.
 */
export const PART_BYTES = 1 << 20;

/**
 * The most one drawing may hold, its pictures counted. A write past it is a 413.
 *
 * A D1 database holds at most 500 MB on the free plan ("Maximum database size",
 * https://developers.cloudflare.com/d1/platform/limits/), and every shared drawing of
 * everyone lives in one. A drawing at 10 MiB stores about 13.3 MiB of base64, 2.8% of it, so
 * at least 35 drawings at the cap fit, and thousands of drawings without photos. It holds two
 * pictures at the app's 4 MiB maximum (`IMAGE_MAX_BYTES`, apps/web) and their scene. The
 * Docker build lets a board reach 16 MB (`boardTooLarge`, apps/api), so a board between the
 * two saves there and is refused here, and the person is told.
 */
export const MAX_DRAWING_BYTES = 10 << 20;

/** The most parts one item is sent in: an item at the cap, in whole parts. */
export const MAX_PARTS = MAX_DRAWING_BYTES / PART_BYTES;

/**
 * How long a drawing's staging may sit idle before its staged uploads count as abandoned:
 * 10 minutes since a staged part last landed. The next write to the drawing then deletes
 * them, so they stop counting against the cap. An upload sends a part in seconds; one that
 * pauses longer than this finds its parts gone at its commit and stages again.
 */
export const STAGED_IDLE_MS = 10 * 60 * 1000;

/*
 * What a request costs on the free plan, and what happens at its limits.
 *
 * Pages Functions count against the Workers Free quota
 * (https://developers.cloudflare.com/pages/functions/pricing/), whose limits are
 * (https://developers.cloudflare.com/workers/platform/limits/): 100,000 requests a day, 10 ms
 * of CPU per request, and a 100 MB request body on a Free zone — never reached, since the
 * store stops reading at PART_BYTES. Waiting on D1 is not CPU time.
 *
 * CPU. No request carries more than one part (Ruling 27), so the worst request is set by
 * PART_BYTES, not by the drawing. Each kind at its worst, on Node 22, 2026-10-20
 * (tests/requests.bench.ts: the handler over a stand-in for the D1 binding's JSON), mean and
 * slowest sample, the higher of two runs:
 *
 *   a new part written — a one-part scene, a staged part, a picture part   3.9 ms   6.3 ms
 *   a part sent again, the same bytes                                      1.4 ms   3.3 ms
 *   a part read, of a scene or a picture                                   1.4 ms   4.1 ms
 *   a commit                                                               0.03 ms  1.9 ms
 *
 * The new part is the worst: base64 and the binding's JSON of a MiB are 3.0 ms of it
 * (tests/d1Codec.bench.ts). Every kind is inside 10 ms without Cloudflare's "some built-in
 * flexibility" for overruns; a Worker that keeps running over is stopped with error 1102. A
 * Node process on a desktop is not a Workers isolate: these are measures, not a promise. The
 * encoding, most of the worst, grows with PART_BYTES, the one figure to cut if they disagree.
 *
 * Requests and rows. D1 Free writes 100,000 rows a day and reads 5,000,000
 * (https://developers.cloudflare.com/d1/platform/pricing/); "Indexes will add an additional
 * written row when writes include the indexed column", and `written_at` is indexed.
 *
 * - A typical save — a scene of one part, no new picture — is 1 request and 3 rows written:
 *   the drawing's row, its `written_at` index row, the part.
 * - A save that adds a 4 MB picture is 5 requests — 4 parts and the scene — and 15 rows. A
 *   picture is write-once, so the saves after it are back to 1 and 3, for a browser that
 *   remembers what it sent.
 * - A scene of k parts is k + 1 requests: its parts, then the commit.
 * - Opening a drawing is 1 request, and 1 more per part of each picture.
 *
 * So rows written run out before requests do. At one save per 20 s per person editing, the
 * 100,000 rows are 33,333 saves, about 185 person-hours of editing shared drawings a day,
 * across everyone — not the 550 that counting requests alone gives — and fewer once pictures
 * take their share; opening drawings spends requests, not rows written. The rows are counted from the SQL in d1.ts and that
 * page, not measured: the local SQLite stand-in has no `rows_written` to read.
 *
 * Nothing at a limit costs money: the free plan refuses work, it does not bill it. Past
 * 100,000 requests a day Workers answer error 1027 until 00:00 UTC (the Pages pages do not say
 * what Pages answers). Past D1's rows a day, or its 500 MB, every D1 call fails and the
 * handlers answer 503 `store_unavailable`.
 *
 * ponytail: the `written_at` index costs a row on every save; upgrade path — refresh
 * `written_at` at most once a day, for 2 rows a save, about 280 person-hours.
 */

/**
 * The most pictures one drawing may hold. With the cap, it bounds the sweep. Every part but
 * an item's last is whole, so a drawing holds at most MAX_DRAWING_BYTES / PART_BYTES whole
 * parts, plus one last part per item: the scene, the pictures, and at most 10 staged uploads,
 * since each holds a whole part 0 — 10 + 1 + 200 + 10 = 221 rows.
 */
export const MAX_PICTURES = 200;

/** A drawing not written for longer than this is swept away: 365 days. */
export const EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * The most expired drawings one write sweeps. Every drawing was written at least once, so
 * one per write keeps up while traffic holds steady; two drain a backlog even when it halves.
 * At most 2 × 221 part rows go in one request.
 */
export const SWEEP_LIMIT = 2;
