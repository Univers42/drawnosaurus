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
 * What one stored part holds, in bytes before encoding. A part is stored as base64 text
 * (`d1.ts` says why), a third larger: 1 MiB becomes 1,398,104 characters, which leaves about
 * 600 KB under the row limit for the key and the row's own overhead.
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

/*
 * What a request costs on the free plan, and what happens at its limits.
 *
 * Pages Functions count against the Workers Free quota
 * (https://developers.cloudflare.com/pages/functions/pricing/), whose limits are
 * (https://developers.cloudflare.com/workers/platform/limits/): 100,000 requests a day, 10 ms
 * of CPU per request, and a 100 MB request body on a Free zone — never reached, since the
 * store stops reading at MAX_DRAWING_BYTES. Waiting on D1 is not CPU time.
 *
 * The CPU goes on encoding: each byte stored is base64-encoded here and JSON-encoded by the D1
 * binding, about 2.9 ms per MiB written and 0.8 per MiB read on Node 22
 * (tests/d1Codec.bench.ts, 2026-10-20). The largest write, a scene at MAX_DRAWING_BYTES, costs
 * about 30 ms; a picture at the app's 4 MiB, about 12; a scene save of a few hundred KB, about
 * 1. So writes over ~3 MiB are over 10 ms. Cloudflare gives an isolate "some built-in
 * flexibility" to run over now and then, but a Worker that keeps doing so is stopped with
 * error 1102, "Worker exceeded resource limits": the browser sees a failed save, and says so.
 *
 * Nothing at a limit costs money: the free plan refuses work, it does not bill it. Past
 * 100,000 requests a day Workers answer error 1027 until 00:00 UTC (the Pages pages do not say
 * what Pages answers). Past D1's 100,000 rows written or 5,000,000 read a day
 * (https://developers.cloudflare.com/d1/platform/pricing/), or its 500 MB, every D1 call fails
 * and the handlers answer 503 `store_unavailable`.
 *
 * ponytail: a write over ~3 MiB leans on that flexibility; upgrade path — the browser sends a
 * large scene or picture one part per request.
 */

/**
 * The most pictures one drawing may hold. It is what bounds the sweep: a drawing holds at
 * most MAX_DRAWING_BYTES / PART_BYTES parts of bytes, plus one part per item for the last,
 * partial part of each — 10 + 201 = 211 rows.
 */
export const MAX_PICTURES = 200;

/** A drawing not written for longer than this is swept away: 365 days. */
export const EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * The most expired drawings one write sweeps. Every drawing was written at least once, so
 * one per write keeps up while traffic holds steady; two drain a backlog even when it halves.
 * At most 2 × 211 part rows go in one request.
 */
export const SWEEP_LIMIT = 2;
