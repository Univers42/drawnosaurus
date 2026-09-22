import { describe, expect, it } from "vitest";
import {
  ensureRoomKey,
  formatRoomHash,
  generateRoomKeyBytes,
  importRoomKey,
  open,
  parseRoomKeyFromHash,
  seal,
  type SealedEnvelope,
} from "./roomCrypto.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("roomCrypto hash helpers", () => {
  it("round-trips a room key through the fragment format", () => {
    const raw = generateRoomKeyBytes();
    const hash = formatRoomHash(raw);
    expect(hash.startsWith("#room=")).toBe(true);
    expect(parseRoomKeyFromHash(hash)).toEqual(raw);
    expect(parseRoomKeyFromHash(hash.slice(1))).toEqual(raw);
  });

  it("returns null when the fragment has no room key", () => {
    expect(parseRoomKeyFromHash("")).toBeNull();
    expect(parseRoomKeyFromHash("#other=1")).toBeNull();
    expect(parseRoomKeyFromHash("#room=")).toBeNull();
    expect(parseRoomKeyFromHash("#room=!!!")).toBeNull();
  });

  it("preserves other fragment params when formatting", () => {
    const raw = generateRoomKeyBytes();
    expect(formatRoomHash(raw, "#foo=1")).toBe(
      `#foo=1&room=${hashWithoutPrefix(formatRoomHash(raw))}`,
    );
  });

  it("ensureRoomKey reuses an existing fragment key", () => {
    const raw = generateRoomKeyBytes();
    const hash = formatRoomHash(raw);
    expect(ensureRoomKey({ hash, pathname: "/boards/x", search: "" })).toEqual(raw);
  });

  it("ensureRoomKey mints a key when the fragment is empty", () => {
    const minted = ensureRoomKey({ hash: "", pathname: "/boards/x", search: "" });
    expect(minted.byteLength).toBe(32);
  });
});

describe("roomCrypto seal/open", () => {
  it("round-trips plaintext under a derived AES-GCM key", async () => {
    const raw = generateRoomKeyBytes();
    const key = await importRoomKey(raw);
    const plain = encoder.encode('{"type":"patch","secret":"MARKER_PLAINTEXT_XYZ"}');
    const envelope = await seal(key, plain);
    expect(envelope.v).toBe(1);
    expect(envelope.iv.length).toBeGreaterThan(0);
    expect(envelope.ct.length).toBeGreaterThan(0);

    const opened = await open(key, envelope);
    expect(opened).not.toBeNull();
    expect(decoder.decode(opened!)).toBe(decoder.decode(plain));
  });

  it("keeps known plaintext out of the wire envelope", async () => {
    const marker = "MARKER_PLAINTEXT_XYZ";
    const raw = generateRoomKeyBytes();
    const key = await importRoomKey(raw);
    const envelope = await seal(
      key,
      encoder.encode(JSON.stringify({ type: "patch", text: marker })),
    );
    const wire = JSON.stringify(envelope);
    expect(wire.includes(marker)).toBe(false);
  });

  it("rejects a tampered ciphertext", async () => {
    const raw = generateRoomKeyBytes();
    const key = await importRoomKey(raw);
    const envelope = await seal(key, encoder.encode("hello"));
    const tampered: SealedEnvelope = {
      ...envelope,
      ct: flipLastBase64UrlChar(envelope.ct),
    };
    expect(await open(key, tampered)).toBeNull();
  });

  it("rejects a ciphertext sealed under a different room key", async () => {
    const keyA = await importRoomKey(generateRoomKeyBytes());
    const keyB = await importRoomKey(generateRoomKeyBytes());
    const envelope = await seal(keyA, encoder.encode("hello"));
    expect(await open(keyB, envelope)).toBeNull();
  });

  it("rejects malformed envelopes", async () => {
    const key = await importRoomKey(generateRoomKeyBytes());
    expect(await open(key, { v: 2, iv: "aa", ct: "bb" })).toBeNull();
    expect(await open(key, { v: 1, iv: "", ct: "" })).toBeNull();
    expect(await open(key, { v: 1, iv: "!!!", ct: "!!!" })).toBeNull();
  });
});

function hashWithoutPrefix(hash: string): string {
  const match = /^#room=([A-Za-z0-9_-]+)$/.exec(hash);
  if (!match?.[1]) throw new Error("expected #room=…");
  return match[1];
}

function flipLastBase64UrlChar(value: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const last = value[value.length - 1]!;
  const idx = alphabet.indexOf(last);
  const flipped = alphabet[(idx + 1) % alphabet.length]!;
  return value.slice(0, -1) + flipped;
}
