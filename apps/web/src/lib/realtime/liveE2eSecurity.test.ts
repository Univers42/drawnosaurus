/**
 * Threat-model tests for live-room end-to-end encryption.
 *
 * These pin the devil conditions from the live-collab E2E plan: confidentiality of
 * sealed frames, GCM authenticity, no plaintext downgrade when keyed, and the room
 * key never appearing on the WebSocket handshake URL. They run under `pnpm test`
 * and again as the named CI step `pnpm test:live-e2e-security`.
 */
import { describe, expect, it } from "vitest";
import { RealtimeChannel, liveSocketUrl } from "./realtimeClient.ts";
import {
  ENVELOPE_VERSION,
  ROOM_KEY_BYTES,
  formatRoomHash,
  generateRoomKeyBytes,
  importRoomKey,
  isSealedEnvelope,
  open,
  parseRoomKeyFromHash,
  seal,
  type SealedEnvelope,
} from "./roomCrypto.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("live E2E encryption security — key material", () => {
  it("mints 256-bit keys that are not degenerate", () => {
    const samples = Array.from({ length: 32 }, () => generateRoomKeyBytes());
    for (const sample of samples) {
      expect(sample.byteLength).toBe(ROOM_KEY_BYTES);
      expect(sample.some((b) => b !== 0)).toBe(true);
    }
    const unique = new Set(samples.map((s) => Buffer.from(s).toString("hex")));
    expect(unique.size).toBe(samples.length);
  });

  it("refuses to import a room key of the wrong length", async () => {
    await expect(importRoomKey(new Uint8Array(16))).rejects.toThrow(/32/);
    await expect(importRoomKey(new Uint8Array(64))).rejects.toThrow(/32/);
  });

  it("rejects truncated or overlong keys encoded in the fragment", () => {
    expect(parseRoomKeyFromHash("#room=AAAA")).toBeNull();
    const long = "A".repeat(86); // would decode to more than 32 bytes if accepted blindly
    expect(parseRoomKeyFromHash(`#room=${long}`)).toBeNull();
  });
});

describe("live E2E encryption security — confidentiality", () => {
  it("exposes only v/iv/ct on the wire envelope", async () => {
    const key = await importRoomKey(generateRoomKeyBytes());
    const envelope = await seal(key, encoder.encode(JSON.stringify({ type: "cursor", x: 1 })));
    expect(Object.keys(envelope).sort()).toEqual(["ct", "iv", "v"]);
    expect(envelope.v).toBe(ENVELOPE_VERSION);
  });

  it("keeps patch text, names and coordinates out of sealed wire JSON", async () => {
    const key = await importRoomKey(generateRoomKeyBytes());
    const channel = new RealtimeChannel("sec", key);
    const secrets = ["TOP_SECRET_NOTE", "Dino 742", "9999.5", "-4242.25"];
    const wire = await channel.encodeOutbound({
      type: "patch",
      clientId: "peer_remote",
      patch: {
        elements: [
          {
            id: "el-secret",
            version: 3,
            versionNonce: 7,
            updated: 100,
            isDeleted: false,
            text: secrets[0],
            x: 9999.5,
            y: -4242.25,
          } as never,
        ],
      },
    });
    expect(wire).toBeTruthy();
    for (const secret of secrets) {
      expect(wire!.includes(secret)).toBe(false);
    }
    expect(wire!.includes("peer_remote")).toBe(false);
    expect(isSealedEnvelope(JSON.parse(wire!))).toBe(true);
  });

  it("seals the same plaintext to different ciphertexts (fresh IV each frame)", async () => {
    const key = await importRoomKey(generateRoomKeyBytes());
    const plain = encoder.encode('{"type":"join","name":"Alice"}');
    const a = await seal(key, plain);
    const b = await seal(key, plain);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
    expect(decoder.decode((await open(key, a))!)).toBe(decoder.decode(plain));
    expect(decoder.decode((await open(key, b))!)).toBe(decoder.decode(plain));
  });
});

describe("live E2E encryption security — authenticity", () => {
  it("rejects a single-bit flip in the ciphertext", async () => {
    const key = await importRoomKey(generateRoomKeyBytes());
    const envelope = await seal(key, encoder.encode("authentic"));
    const tampered: SealedEnvelope = { ...envelope, ct: flipOneDecodedByte(envelope.ct) };
    expect(await open(key, tampered)).toBeNull();
  });

  it("rejects a single-bit flip in the IV", async () => {
    const key = await importRoomKey(generateRoomKeyBytes());
    const envelope = await seal(key, encoder.encode("authentic"));
    const tampered: SealedEnvelope = { ...envelope, iv: flipOneDecodedByte(envelope.iv) };
    expect(await open(key, tampered)).toBeNull();
  });

  it("rejects truncated ciphertext and wrong envelope version", async () => {
    const key = await importRoomKey(generateRoomKeyBytes());
    const envelope = await seal(key, encoder.encode("authentic"));
    expect(await open(key, { ...envelope, ct: envelope.ct.slice(0, 8) })).toBeNull();
    expect(await open(key, { ...envelope, v: ENVELOPE_VERSION + 1 })).toBeNull();
    expect(await open(key, { ...envelope, v: 0 })).toBeNull();
  });

  it("rejects cross-message IV/ciphertext swaps", async () => {
    const key = await importRoomKey(generateRoomKeyBytes());
    const a = await seal(key, encoder.encode("message-a"));
    const b = await seal(key, encoder.encode("message-b"));
    expect(await open(key, { v: 1, iv: a.iv, ct: b.ct })).toBeNull();
    expect(await open(key, { v: 1, iv: b.iv, ct: a.ct })).toBeNull();
  });
});

describe("live E2E encryption security — key isolation", () => {
  it("a peer without the room key cannot open sealed frames", async () => {
    const holder = await importRoomKey(generateRoomKeyBytes());
    const outsider = await importRoomKey(generateRoomKeyBytes());
    const envelope = await seal(holder, encoder.encode("board secret"));
    expect(await open(outsider, envelope)).toBeNull();
  });

  it("two independently minted fragment keys never decrypt each other", async () => {
    const rawA = generateRoomKeyBytes();
    const rawB = generateRoomKeyBytes();
    expect(Buffer.from(rawA).equals(Buffer.from(rawB))).toBe(false);
    const keyA = await importRoomKey(rawA);
    const keyB = await importRoomKey(parseRoomKeyFromHash(formatRoomHash(rawB))!);
    const envelope = await seal(keyA, encoder.encode("only-for-A"));
    expect(await open(keyB, envelope)).toBeNull();
  });
});

describe("live E2E encryption security — downgrade resistance", () => {
  it("keyed channels drop plaintext frames (server/network downgrade)", async () => {
    const channel = new RealtimeChannel("sec", await importRoomKey(generateRoomKeyBytes()));
    let patch: unknown = null;
    let peers = 0;
    channel.onRemotePatch((p) => {
      patch = p;
    });
    channel.onPeers((list) => {
      peers = list.length;
    });

    await channel.receiveFrame(
      JSON.stringify({
        type: "patch",
        clientId: "attacker",
        patch: {
          elements: [{ id: "x", version: 1, versionNonce: 1, updated: 1, isDeleted: false }],
        },
      }),
    );
    await channel.receiveFrame(
      JSON.stringify({
        type: "cursor",
        clientId: "attacker",
        name: "Eve",
        color: "#000000",
        x: 1,
        y: 2,
      }),
    );

    expect(patch).toBeNull();
    expect(peers).toBe(0);
  });

  it("unkeyed channels cannot consume sealed frames", async () => {
    const key = await importRoomKey(generateRoomKeyBytes());
    const sender = new RealtimeChannel("sec", key);
    const unkeyed = new RealtimeChannel("sec", null);
    let patch: unknown = null;
    unkeyed.onRemotePatch((p) => {
      patch = p;
    });

    const wire = await sender.encodeOutbound({
      type: "patch",
      clientId: "peer_remote",
      patch: {
        elements: [{ id: "el1", version: 1, versionNonce: 1, updated: 1, isDeleted: false }],
      } as never,
    });
    await unkeyed.receiveFrame(wire!);
    expect(patch).toBeNull();
  });

  it("keyed channels drop envelopes that look sealed but fail auth", async () => {
    const channel = new RealtimeChannel("sec", await importRoomKey(generateRoomKeyBytes()));
    let patch: unknown = null;
    channel.onRemotePatch((p) => {
      patch = p;
    });
    await channel.receiveFrame(
      JSON.stringify({ v: 1, iv: "AAAAAAAAAAAAAAAA", ct: "BBBBBBBBBBBBBBBB" }),
    );
    expect(patch).toBeNull();
  });
});

describe("live E2E encryption security — key never reaches the API URL", () => {
  it("strips fragment room keys from the WebSocket handshake URL", () => {
    const page = "https://app.example/boards/abc#room=should-never-leak-to-ws";
    const url = liveSocketUrl("abc", "https://api.example", page);
    expect(url).toBe("wss://api.example/v1/boards/abc/live");
    expect(url.includes("room=")).toBe(false);
    expect(url.includes("should-never-leak")).toBe(false);
  });

  it("strips query-string attempts to smuggle the room key onto the socket", () => {
    const page = "https://app.example/boards/abc?room=smuggled-key#room=real-key";
    const url = liveSocketUrl("abc", "https://api.example/", page);
    expect(url).toBe("wss://api.example/v1/boards/abc/live");
    expect(url.includes("smuggled-key")).toBe(false);
    expect(url.includes("real-key")).toBe(false);
    expect(url.includes("?")).toBe(false);
  });
});

function flipOneDecodedByte(base64Url: string): string {
  const padded = base64Url + "=".repeat((4 - (base64Url.length % 4)) % 4);
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  expect(bytes.byteLength).toBeGreaterThan(0);
  bytes[0] = bytes[0]! ^ 0x01;
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return btoa(out).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
