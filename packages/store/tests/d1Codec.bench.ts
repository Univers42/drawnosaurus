import { bench, describe } from "vitest";
import { decodePart, encodePart } from "../src/d1.ts";
import { PART_BYTES } from "../src/limits.ts";

/*
 * What a stored part costs in CPU, the free plan's tightest limit (10 ms a request). The D1
 * binding JSON-encodes what it sends and JSON-decodes what it gets back; a BLOB crosses as an
 * array of numbers, a TEXT as a string. Each bench is one part of PART_BYTES, 1 MiB, so its
 * mean is milliseconds per MiB:
 *
 *   pnpm --filter @drawnosaurus/store exec vitest bench --run
 */
const part = new Uint8Array(PART_BYTES).map((_, i) => Math.imul(i, 2654435761) >>> 24);
const asText = JSON.stringify([encodePart(part)]);
const asNumbers = JSON.stringify([Array.from(part)]);

describe("one MiB part through the D1 binding", () => {
  bench("written as base64 text, as d1.ts does", () => {
    JSON.stringify([encodePart(part)]);
  });
  bench("written as a BLOB", () => {
    JSON.stringify([Array.from(part)]);
  });
  bench("read as base64 text, as d1.ts does", () => {
    decodePart((JSON.parse(asText) as string[])[0] ?? "");
  });
  bench("read as a BLOB", () => {
    Uint8Array.from((JSON.parse(asNumbers) as number[][])[0] ?? []);
  });
});
