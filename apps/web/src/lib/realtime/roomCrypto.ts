/**
 * Live-room end-to-end crypto: a fragment-carried secret derives an AES-256-GCM
 * key via HKDF. The API never sees the fragment, so sealed wire frames stay opaque
 * to the blind WebSocket relay. Persistence (HTTP/Mongo) is a separate concern.
 *
 * # Without a secure context
 *
 * The browser only offers `crypto.subtle` to pages served over https or from
 * localhost. A colleague opening the board at `http://10.12.19.1:5273` over the LAN
 * gets none, and live collaboration died on the first line that touched it — the key
 * could not even be imported, so the socket was never opened. There, the same HKDF and
 * AES-256-GCM run in audited pure JavaScript (`@noble/*`): the same key from the same
 * secret, the same envelope byte for byte, so a peer on http and one on localhost read
 * each other's frames. `crypto.getRandomValues`, which the IVs and room keys come from,
 * is available in every context.
 */

import { gcm } from "@noble/ciphers/aes.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

export const ROOM_HASH_PARAM = "room";
export const HKDF_INFO = "drawnosaurus-live-v1";
export const ROOM_KEY_BYTES = 32;
export const IV_BYTES = 12;
export const ENVELOPE_VERSION = 1;

export interface SealedEnvelope {
  v: number;
  iv: string;
  ct: string;
}

const textEncoder = new TextEncoder();

export function generateRoomKeyBytes(): Uint8Array {
  const raw = new Uint8Array(ROOM_KEY_BYTES);
  crypto.getRandomValues(raw);
  return raw;
}

export function formatRoomHash(raw: Uint8Array, existingHash = ""): string {
  const encoded = bytesToBase64Url(raw);
  const params = new URLSearchParams(stripHashPrefix(existingHash));
  params.delete(ROOM_HASH_PARAM);
  params.set(ROOM_HASH_PARAM, encoded);
  // URLSearchParams uses + for spaces; our alphabet has none. Keep deterministic order
  // with room last so a human scanning the URL sees the capability secret clearly.
  const others: string[] = [];
  let roomValue: string | null = null;
  for (const [key, value] of params.entries()) {
    if (key === ROOM_HASH_PARAM) {
      roomValue = value;
      continue;
    }
    others.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  if (roomValue === null) {
    throw new Error("room key missing after format");
  }
  const body = [...others, `${ROOM_HASH_PARAM}=${roomValue}`].join("&");
  return `#${body}`;
}

export function parseRoomKeyFromHash(hash: string): Uint8Array | null {
  const params = new URLSearchParams(stripHashPrefix(hash));
  const value = params.get(ROOM_HASH_PARAM);
  if (!value) return null;
  try {
    const raw = base64UrlToBytes(value);
    if (raw.byteLength !== ROOM_KEY_BYTES) return null;
    return raw;
  } catch {
    return null;
  }
}

const ROOM_KEY_STORAGE_PREFIX = "drawnosaurus:roomKey:";

/**
 * Stable 32-byte material for a board slug. Every peer that opens the same board
 * without an explicit `#room=` secret derives the same key, so live patches decrypt
 * without requiring a shared capability link first.
 */
export async function deriveBoardRoomKeyBytes(slug: string): Promise<Uint8Array> {
  const ikm = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(`drawnosaurus-board:${slug}`),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(),
      info: textEncoder.encode(`${HKDF_INFO}:board-room`),
    },
    ikm,
    ROOM_KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

function persistRoomKey(slug: string, raw: Uint8Array): void {
  if (typeof localStorage === "undefined" || !slug) return;
  try {
    localStorage.setItem(`${ROOM_KEY_STORAGE_PREFIX}${slug}`, bytesToBase64Url(raw));
  } catch {
    // Quota / private mode — derivation still converges without storage.
  }
}

function writeRoomHash(
  locationLike: { hash: string; pathname: string; search: string },
  raw: Uint8Array,
): void {
  const nextHash = formatRoomHash(raw, locationLike.hash);
  if (typeof history !== "undefined") {
    history.replaceState(null, "", `${locationLike.pathname}${locationLike.search}${nextHash}`);
  }
}

/**
 * Resolve the AES room material for live collab on a board.
 *
 * Every peer on the same slug derives the same key, so opening `/boards/{slug}`
 * in two tabs (or browsers) decrypts live frames without a prior share step.
 * The fragment is rewritten to mirror that key so the share link stays useful;
 * a mismatched legacy `#room=` (from the old per-tab mint) is replaced so stuck
 * sessions recover on reload.
 */
export async function resolveRoomKey(
  slug: string,
  locationLike: { hash: string; pathname: string; search: string },
): Promise<Uint8Array> {
  const derived = await deriveBoardRoomKeyBytes(slug);
  persistRoomKey(slug, derived);
  const fromHash = parseRoomKeyFromHash(locationLike.hash);
  if (!fromHash || !bytesEqual(fromHash, derived)) {
    writeRoomHash(locationLike, derived);
  }
  return derived;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/**
 * @deprecated Prefer {@link resolveRoomKey} — random minting made each tab a
 * different crypto room, so live collab never converged without a shared link.
 */
export function ensureRoomKey(locationLike: {
  hash: string;
  pathname: string;
  search: string;
}): Uint8Array {
  const existing = parseRoomKeyFromHash(locationLike.hash);
  if (existing) return existing;
  const raw = generateRoomKeyBytes();
  writeRoomHash(locationLike, raw);
  return raw;
}

/**
 * A room key, ready to seal and open frames: the browser's own AES-GCM when it offers
 * one, the pure-JavaScript one when it does not — see the module notes.
 */
export type RoomKey =
  | { readonly engine: "webcrypto"; readonly subtle: SubtleCrypto; readonly key: CryptoKey }
  | { readonly engine: "fallback"; readonly key: Uint8Array };

/** What this page has for Web Crypto: none outside a secure context. */
const pageSubtle = (): SubtleCrypto | undefined =>
  (globalThis.crypto as Crypto | undefined)?.subtle ?? undefined;

/**
 * Derives the room's AES-256-GCM key from the fragment secret.
 *
 * `subtle` is the page's by default; pass `null` to take the fallback, as a page outside
 * a secure context does.
 */
export async function importRoomKey(
  raw: Uint8Array,
  subtle: SubtleCrypto | null = pageSubtle() ?? null,
): Promise<RoomKey> {
  if (raw.byteLength !== ROOM_KEY_BYTES) {
    throw new Error(`room key must be ${ROOM_KEY_BYTES} bytes`);
  }
  const info = textEncoder.encode(HKDF_INFO);
  if (!subtle) {
    // RFC 5869 with an empty salt, exactly as Web Crypto's HKDF below.
    return { engine: "fallback", key: hkdf(sha256, raw, new Uint8Array(), info, 32) };
  }
  // Copy into a fresh ArrayBuffer-backed view — TS's BufferSource rejects SharedArrayBuffer-typed views.
  const material = toArrayBuffer(raw);
  const baseKey = await subtle.importKey("raw", material, "HKDF", false, ["deriveKey"]);
  const key = await subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  return { engine: "webcrypto", subtle, key };
}

export async function seal(key: RoomKey, plaintext: Uint8Array): Promise<SealedEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  // Ciphertext then the 16-byte tag, in both: the envelope is the same either way.
  const ciphertext =
    key.engine === "webcrypto"
      ? new Uint8Array(
          await key.subtle.encrypt(
            { name: "AES-GCM", iv: toArrayBuffer(iv) },
            key.key,
            toArrayBuffer(plaintext),
          ),
        )
      : gcm(key.key, iv).encrypt(plaintext);
  return {
    v: ENVELOPE_VERSION,
    iv: bytesToBase64Url(iv),
    ct: bytesToBase64Url(ciphertext),
  };
}

export async function open(key: RoomKey, envelope: SealedEnvelope): Promise<Uint8Array | null> {
  if (envelope.v !== ENVELOPE_VERSION || !envelope.iv || !envelope.ct) {
    return null;
  }
  try {
    const iv = base64UrlToBytes(envelope.iv);
    const ct = base64UrlToBytes(envelope.ct);
    if (iv.byteLength !== IV_BYTES || ct.byteLength === 0) return null;
    if (key.engine === "fallback") return gcm(key.key, iv).decrypt(ct);
    return new Uint8Array(
      await key.subtle.decrypt(
        { name: "AES-GCM", iv: toArrayBuffer(iv) },
        key.key,
        toArrayBuffer(ct),
      ),
    );
  } catch {
    // A wrong key or a tampered frame: the tag does not verify, in either engine.
    return null;
  }
}

export function isSealedEnvelope(value: unknown): value is SealedEnvelope {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.v === ENVELOPE_VERSION &&
    typeof candidate.iv === "string" &&
    typeof candidate.ct === "string"
  );
}

function stripHashPrefix(hash: string): string {
  return hash.startsWith("#") ? hash.slice(1) : hash;
}

/** Guarantee an ArrayBuffer-backed BufferSource for Web Crypto (not SharedArrayBuffer). */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new Error("invalid base64url");
  }
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}
