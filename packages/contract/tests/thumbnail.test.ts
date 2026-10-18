import { describe, expect, it } from "vitest";
import { isPngBytes } from "../src/thumbnail.ts";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("isPngBytes", () => {
  it("accepts the PNG signature, with or without data behind it", () => {
    expect(isPngBytes(new Uint8Array(SIGNATURE))).toBe(true);
    expect(isPngBytes(new Uint8Array([...SIGNATURE, 1, 2, 3]))).toBe(true);
  });

  it("refuses empty, short and wrong-signature input", () => {
    expect(isPngBytes(new Uint8Array())).toBe(false);
    expect(isPngBytes(new Uint8Array(SIGNATURE.slice(0, 7)))).toBe(false);
    expect(isPngBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]))).toBe(false);
    expect(isPngBytes(new TextEncoder().encode("<svg></svg>"))).toBe(false);
  });

  it("refuses a signature differing in one byte", () => {
    const bytes = new Uint8Array(SIGNATURE);
    bytes[7] = 0x0b;
    expect(isPngBytes(bytes)).toBe(false);
  });
});
