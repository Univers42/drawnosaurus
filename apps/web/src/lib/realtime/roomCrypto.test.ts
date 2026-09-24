import { describe, expect, it } from "vitest";
import {
  deriveBoardRoomKeyBytes,
  ensureRoomKey,
  formatRoomHash,
  generateRoomKeyBytes,
  importRoomKey,
  open,
  parseRoomKeyFromHash,
  resolveRoomKey,
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

describe("resolveRoomKey", () => {
  it("derives the same key for the same board slug", async () => {
    const a = await deriveBoardRoomKeyBytes("board-alpha");
    const b = await deriveBoardRoomKeyBytes("board-alpha");
    const c = await deriveBoardRoomKeyBytes("board-beta");
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("lets two peers without a fragment converge on one key", async () => {
    const locA = { hash: "", pathname: "/boards/shared", search: "" };
    const locB = { hash: "", pathname: "/boards/shared", search: "" };
    const keyA = await resolveRoomKey("shared", locA);
    const keyB = await resolveRoomKey("shared", locB);
    expect(keyA).toEqual(keyB);
    expect(keyA.byteLength).toBe(32);
  });

  it("rewrites a legacy mismatched #room= to the board-derived key", async () => {
    const legacy = generateRoomKeyBytes();
    const loc = {
      hash: formatRoomHash(legacy),
      pathname: "/boards/shared",
      search: "",
    };
    const resolved = await resolveRoomKey("shared", loc);
    const derived = await deriveBoardRoomKeyBytes("shared");
    expect(resolved).toEqual(derived);
    expect(resolved).not.toEqual(legacy);
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

  it("board-derived keys seal and open across peers", async () => {
    const rawA = await deriveBoardRoomKeyBytes("collab-board");
    const rawB = await deriveBoardRoomKeyBytes("collab-board");
    const keyA = await importRoomKey(rawA);
    const keyB = await importRoomKey(rawB);
    const envelope = await seal(keyA, encoder.encode('{"type":"patch"}'));
    const opened = await open(keyB, envelope);
    expect(opened).not.toBeNull();
    expect(decoder.decode(opened!)).toBe('{"type":"patch"}');
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

describe("roomCrypto without a secure context", () => {
  // `crypto.subtle` exists only on https and localhost. A colleague on the LAN opens the
  // board at http://10.x.x.x and has none; the fallback must be the same cipher, or the
  // two of them sit in one room unable to read a word of each other.
  it("takes the fallback when there is no Web Crypto", async () => {
    const key = await importRoomKey(generateRoomKeyBytes(), null);
    expect(key.engine).toBe("fallback");
    expect((await importRoomKey(generateRoomKeyBytes())).engine).toBe("webcrypto");
  });

  it("derives the same board room key with or without Web Crypto", async () => {
    const withSubtle = await deriveBoardRoomKeyBytes("lan-board");
    const real = globalThis.crypto.subtle;
    Object.defineProperty(globalThis.crypto, "subtle", {
      configurable: true,
      get: () => undefined,
    });
    try {
      const without = await deriveBoardRoomKeyBytes("lan-board");
      expect(without).toEqual(withSubtle);
    } finally {
      Object.defineProperty(globalThis.crypto, "subtle", { configurable: true, get: () => real });
    }
  });

  it("opens what Web Crypto sealed, and seals what Web Crypto opens", async () => {
    const raw = generateRoomKeyBytes();
    const onLocalhost = await importRoomKey(raw);
    const onTheLan = await importRoomKey(raw, null);
    const message = encoder.encode(JSON.stringify({ type: "cursor", x: 12, y: 34 }));

    const fromLocalhost = await seal(onLocalhost, message);
    expect(decoder.decode((await open(onTheLan, fromLocalhost))!)).toBe(decoder.decode(message));

    const fromTheLan = await seal(onTheLan, message);
    expect(decoder.decode((await open(onLocalhost, fromTheLan))!)).toBe(decoder.decode(message));
  });

  it("refuses a tampered frame and a stranger's key, as Web Crypto does", async () => {
    const raw = generateRoomKeyBytes();
    const key = await importRoomKey(raw, null);
    const envelope = await seal(key, encoder.encode("hello"));

    expect(await open(key, { ...envelope, ct: flipLastBase64UrlChar(envelope.ct) })).toBeNull();
    expect(await open(await importRoomKey(generateRoomKeyBytes(), null), envelope)).toBeNull();
    expect(await open(key, { v: 1, iv: "!!!", ct: "!!!" })).toBeNull();
  });
});
