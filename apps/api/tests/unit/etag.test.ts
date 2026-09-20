import { describe, expect, it } from "vitest";
import { etagFor, parseIfMatch } from "../../src/boards/etag.ts";
import { ApiError } from "../../src/errors.ts";

describe("etagFor", () => {
  it("quotes the rev, as an ETag must be", () => {
    expect(etagFor(7)).toBe('"7"');
  });
});

describe("parseIfMatch", () => {
  it("accepts the shapes clients and proxies actually send", () => {
    expect(parseIfMatch('"3"')).toBe(3);
    expect(parseIfMatch("3")).toBe(3);
    expect(parseIfMatch('W/"3"')).toBe(3);
    expect(parseIfMatch("  \t42 ")).toBe(42);
  });

  it("treats * as 'whatever is current'", () => {
    expect(parseIfMatch("*")).toBe("*");
  });

  it("demands the header with 428 rather than guessing", () => {
    for (const missing of [undefined, "", "   "]) {
      expect(() => parseIfMatch(missing)).toThrowError(
        expect.objectContaining({ status: 428 }) as unknown as Error,
      );
    }
  });

  it("rejects a non-numeric validator with 400", () => {
    try {
      parseIfMatch('"abc"');
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(400);
    }
  });
});
