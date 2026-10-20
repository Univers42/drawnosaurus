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
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

export const ROOM_HASH_PARAM = "room";
export const HKDF_INFO = "drawnosaurus-live-v1";
export const ROOM_KEY_BYTES = 32;
export const IV_BYTES = 12;
export const ENVELOPE_VERSION = 1;
/** HKDF's info for the online copy's write token (`deriveWriteToken`). */
export const WRITE_TOKEN_INFO = "hydrawn-store-write-v1";
/** HKDF's info for the key a picture's name in the online copy is an HMAC under. */
export const PICTURE_ID_INFO = "hydrawn-store-picture-v1";

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

/** What this page has for Web Crypto: none outside a secure context. */
const pageSubtle = (): SubtleCrypto | undefined =>
  (globalThis.crypto as Crypto | undefined)?.subtle ?? undefined;

/**
 * Stable 32-byte material for a board slug. Every peer that opens the same board
 * without an explicit `#room=` secret derives the same key, so live patches decrypt
 * without requiring a shared capability link first.
 *
 * Uses `@noble/hashes` when `crypto.subtle` is missing (plain http LAN), matching the
 * Web Crypto HKDF below byte for byte so a peer without SubtleCrypto still shares the
 * same board room as one on localhost.
 */
export async function deriveBoardRoomKeyBytes(slug: string): Promise<Uint8Array> {
  const ikmMaterial = textEncoder.encode(`drawnosaurus-board:${slug}`);
  const info = textEncoder.encode(`${HKDF_INFO}:board-room`);
  const subtle = pageSubtle();
  if (!subtle) {
    // RFC 5869 with an empty salt — identical to the Web Crypto path below.
    return hkdf(sha256, ikmMaterial, new Uint8Array(), info, ROOM_KEY_BYTES);
  }
  const ikm = await subtle.importKey("raw", ikmMaterial, "HKDF", false, ["deriveBits"]);
  const bits = await subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info },
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

/** AES-256-GCM: the ciphertext, then the 16-byte tag, in both engines. */
async function encrypt(key: RoomKey, iv: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  if (key.engine === "fallback") return gcm(key.key, iv).encrypt(plaintext);
  return new Uint8Array(
    await key.subtle.encrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv) },
      key.key,
      toArrayBuffer(plaintext),
    ),
  );
}

/** What `encrypt` sealed, or null: a wrong key or a tampered byte, in either engine. */
async function decrypt(
  key: RoomKey,
  iv: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array | null> {
  try {
    if (key.engine === "fallback") return gcm(key.key, iv).decrypt(ciphertext);
    return new Uint8Array(
      await key.subtle.decrypt(
        { name: "AES-GCM", iv: toArrayBuffer(iv) },
        key.key,
        toArrayBuffer(ciphertext),
      ),
    );
  } catch {
    return null;
  }
}

export async function seal(key: RoomKey, plaintext: Uint8Array): Promise<SealedEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  return {
    v: ENVELOPE_VERSION,
    iv: bytesToBase64Url(iv),
    ct: bytesToBase64Url(await encrypt(key, iv, plaintext)),
  };
}

export async function open(key: RoomKey, envelope: SealedEnvelope): Promise<Uint8Array | null> {
  if (envelope.v !== ENVELOPE_VERSION || !envelope.iv || !envelope.ct) {
    return null;
  }
  let iv: Uint8Array;
  let ct: Uint8Array;
  try {
    iv = base64UrlToBytes(envelope.iv);
    ct = base64UrlToBytes(envelope.ct);
  } catch {
    return null;
  }
  if (iv.byteLength !== IV_BYTES || ct.byteLength === 0) return null;
  return decrypt(key, iv, ct);
}

/**
 * Bytes sealed for the online copy: the IV, then the ciphertext and its tag. Binary, not the
 * live frames' JSON envelope — the store keeps bytes, and base64 would be a third more of
 * them against its cap.
 */
export async function sealBytes(key: RoomKey, plaintext: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await encrypt(key, iv, plaintext);
  const sealed = new Uint8Array(IV_BYTES + ciphertext.byteLength);
  sealed.set(iv);
  sealed.set(ciphertext, IV_BYTES);
  return sealed;
}

/** What `sealBytes` sealed, or null when it was sealed under another secret or changed. */
export async function openBytes(key: RoomKey, sealed: Uint8Array): Promise<Uint8Array | null> {
  // A tag is 16 bytes: anything shorter than an IV and a tag cannot have been sealed.
  if (sealed.byteLength < IV_BYTES + 16) return null;
  return decrypt(key, sealed.subarray(0, IV_BYTES), sealed.subarray(IV_BYTES));
}

/**
 * HKDF-SHA256 of the secret with an empty salt, as RFC 5869 has it: Web Crypto's when the
 * page has it, `@noble`'s when it has not, byte for byte the same.
 */
async function hkdfBytes(
  raw: Uint8Array,
  info: string,
  subtle: SubtleCrypto | null,
): Promise<Uint8Array> {
  const label = textEncoder.encode(info);
  if (!subtle) return hkdf(sha256, raw, new Uint8Array(), label, 32);
  const ikm = await subtle.importKey("raw", toArrayBuffer(raw), "HKDF", false, ["deriveBits"]);
  const bits = await subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: label },
    ikm,
    256,
  );
  return new Uint8Array(bits);
}

/**
 * The online copy's write token: the bearer whose SHA-256 the store keeps from the first
 * write and checks on every later one (`packages/store/src/handlers.ts`). From the secret
 * alone, so everyone holding the link writes with the same one, on Web Crypto or without;
 * base64url, 43 characters, inside the store's bearer pattern.
 */
export async function deriveWriteToken(
  raw: Uint8Array,
  subtle: SubtleCrypto | null = pageSubtle() ?? null,
): Promise<string> {
  return bytesToBase64Url(await hkdfBytes(raw, WRITE_TOKEN_INFO, subtle));
}

/**
 * What a picture is called in the online copy: an HMAC over its bytes, under a key HKDF
 * draws from the secret — 128 bits, as 32 hex digits, which the store's id rule takes.
 *
 * Derived from the content, so two browsers sending one picture name it alike and the
 * second is told it is already there (the store's write-once 409). Keyed, so the store
 * cannot tell one picture from a known one: a plain hash would let it check which picture
 * it holds against any copy found elsewhere.
 */
export async function pictureStoreId(
  raw: Uint8Array,
  bytes: Uint8Array,
  subtle: SubtleCrypto | null = pageSubtle() ?? null,
): Promise<string> {
  const key = await hkdfBytes(raw, PICTURE_ID_INFO, subtle);
  let mac: Uint8Array;
  if (subtle) {
    const hmacKey = await subtle.importKey(
      "raw",
      toArrayBuffer(key),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    mac = new Uint8Array(await subtle.sign("HMAC", hmacKey, toArrayBuffer(bytes)));
  } else {
    mac = hmac(sha256, key, bytes);
  }
  return Array.from(mac.subarray(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
