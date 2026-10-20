import { applyOrder, reconcileElements } from "@drawnosaurus/contract";
import { MAX_PARTS, PART_BYTES } from "@drawnosaurus/store/limits";
import { ApiClientError } from "../api/client.ts";
import type { FailureKind } from "../autosave/autosaver.ts";
import { PictureLedger } from "../autosave/pictures.ts";
import type { ScenePatch, StampedElement } from "../autosave/sceneDiff.ts";
import {
  deriveWriteToken,
  importRoomKey,
  openBytes,
  pictureStoreId,
  sealBytes,
  type RoomKey,
} from "../realtime/roomCrypto.ts";
import { compress, decompress } from "./compress.ts";

/**
 * A shared drawing's online copy: what someone opening the link finds after the sharer has
 * gone. The store (`packages/store/src/handlers.ts`, whose header is the protocol) keeps
 * sealed bytes and can open none of them; this end compresses, seals, merges and opens.
 *
 * - The scene is stored without its pictures, each image naming its picture by a keyed id
 *   (`pictureStoreId`), and every picture is stored once, write-once.
 * - A save merges what this page changed into the copy as the API merges a patch
 *   (`reconcileElements`, then `applyOrder`), and writes it back on the rev it read; when
 *   another save landed first, it reads again and merges again, at most ATTEMPTS times.
 * - A failure is an `ApiClientError`, as the API client's are, so the page tells them
 *   apart the way it does for the Docker build (`classifyShared`).
 */

/** Rounds of a save beaten by another, and of a read whose parts moved under it. */
const ATTEMPTS = 5;

/** The most a request may carry while the page is closing (`fetch` with `keepalive`). */
const KEEPALIVE_BYTES = 64 * 1024;

/** A picture sealed as its data URL's header, a newline, then the bytes the URL encodes. */
const DECODED = 1;
/** A picture sealed as its data URL's text, for one that is not valid base64. */
const VERBATIM = 2;
const NEWLINE = 0x0a;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** What the store holds, sealed: the scene without pictures, and each image's picture. */
interface CopyDocument<T> {
  type: "hydrawn-copy";
  version: 1;
  elements: T[];
  /** Element id → picture id, for each live image whose picture is stored. */
  pictures: Record<string, string>;
}

interface Stored<T> {
  rev: number;
  elements: T[];
  refs: Map<string, string>;
}

interface Pictured {
  id: string;
  isDeleted: boolean;
  dataUrl?: string;
}

export interface StoredCopyOptions {
  slug: string;
  /** The drawing's 32-byte secret, from its link. */
  secret: Uint8Array;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

/** Part 1 of an item moved while it was read: read it again from part 0. */
const MOVED = Symbol("moved");

const pictured = (element: object): Pictured => element as Pictured;

function withoutPicture<T extends object>(element: T): T {
  if (!("dataUrl" in element)) return element;
  const bare = { ...element } as T & { dataUrl?: string };
  delete bare.dataUrl;
  return bare;
}

const tooLarge = (): ApiClientError =>
  new ApiClientError(413, "drawing_too_large", "the drawing is larger than its online copy holds");

const unreadable = (): ApiClientError =>
  new ApiClientError(403, "unreadable", "the online copy does not open with this link's secret");

const badAnswer = (what: string): ApiClientError =>
  new ApiClientError(502, "bad_response", `the online copy answered with ${what}`);

async function failed(response: Response): Promise<ApiClientError> {
  const envelope = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  return new ApiClientError(
    response.status,
    envelope?.error?.code ?? "http_error",
    envelope?.error?.message ?? `the online copy answered ${response.status}`,
  );
}

function revOf(etag: string | null): number {
  const rev = /^"(0|[1-9]\d{0,14})"$/.exec(etag ?? "")?.[1];
  if (rev === undefined) throw badAnswer(`the ETag ${String(etag)}`);
  return Number(rev);
}

function partsOf(header: string | null): number {
  const total = Number(header ?? "1");
  if (!Number.isInteger(total) || total < 1 || total > MAX_PARTS) {
    throw badAnswer(`x-parts ${String(header)}`);
  }
  return total;
}

/** Whole parts, then the rest: how the store takes an item. Copies, each its own buffer. */
function split(bytes: Uint8Array): Uint8Array<ArrayBuffer>[] {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  for (let at = 0; at < bytes.byteLength; at += PART_BYTES) {
    parts.push(bytes.slice(at, at + PART_BYTES));
  }
  if (parts.length > MAX_PARTS) throw tooLarge();
  return parts;
}

function join(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

function concat(...parts: (Uint8Array | number[])[]): Uint8Array {
  return join(parts.map((part) => (part instanceof Uint8Array ? part : Uint8Array.from(part))));
}

/** An id for one upload: 128 random bits in hex, inside the store's id rule. */
const uploadId = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

function fromBase64(text: string): Uint8Array | null {
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    return null;
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  // In slices: an argument list of megabytes overflows the stack.
  for (let at = 0; at < bytes.byteLength; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

/**
 * A picture as it is sealed. Its bytes, not their base64: a third smaller against the
 * store's cap, which then holds two pictures of the app's largest beside a scene.
 */
function pictureBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  const head = comma > 0 ? dataUrl.slice(0, comma) : "";
  const decoded = head.endsWith(";base64") ? fromBase64(dataUrl.slice(comma + 1)) : null;
  return decoded === null
    ? concat([VERBATIM], textEncoder.encode(dataUrl))
    : concat([DECODED], textEncoder.encode(head), [NEWLINE], decoded);
}

function pictureUrl(bytes: Uint8Array): string | null {
  if (bytes[0] === VERBATIM) return textDecoder.decode(bytes.subarray(1));
  const newline = bytes.indexOf(NEWLINE);
  if (bytes[0] !== DECODED || newline < 0) return null;
  return `${textDecoder.decode(bytes.subarray(1, newline))},${toBase64(bytes.subarray(newline + 1))}`;
}

/** Each live element's picture id, from the first of `sources` that has one. */
function refsFor(
  elements: readonly StampedElement[],
  ...sources: ReadonlyMap<string, string>[]
): Map<string, string> {
  const refs = new Map<string, string>();
  for (const { id, isDeleted } of elements) {
    if (isDeleted) continue;
    const pid = sources.map((source) => source.get(id)).find((found) => found !== undefined);
    if (pid !== undefined) refs.set(id, pid);
  }
  return refs;
}

function isDocument(value: unknown): value is CopyDocument<unknown> {
  if (!value || typeof value !== "object") return false;
  const doc = value as Partial<CopyDocument<unknown>>;
  return (
    doc.type === "hydrawn-copy" &&
    doc.version === 1 &&
    Array.isArray(doc.elements) &&
    doc.elements.every(
      (element) =>
        element !== null &&
        typeof element === "object" &&
        typeof (element as { id?: unknown }).id === "string",
    ) &&
    doc.pictures !== null &&
    typeof doc.pictures === "object" &&
    Object.values(doc.pictures).every((pid) => typeof pid === "string")
  );
}

/** What the page's autosaver makes of a failure: the same answers as the Docker build's. */
export function classifyShared(error: unknown): FailureKind {
  if (!(error instanceof ApiClientError)) return "retry";
  if (error.status === 413) return "too-large";
  // 403: another drawing's link, or none of this one; 400 and 422: a request it will refuse
  // again. Neither changes by trying again.
  if (error.status === 400 || error.status === 403 || error.status === 422) return "refused";
  return "retry";
}

export class StoredCopy<T extends StampedElement> {
  /** Set while the page is closing: a request of KEEPALIVE_BYTES or less may outlive it. */
  leaving = false;

  private readonly base: string;
  private readonly secret: Uint8Array;
  private readonly fetch: (input: string, init?: RequestInit) => Promise<Response>;
  private sealing: Promise<RoomKey> | null = null;
  private token: Promise<string> | null = null;
  /** The copy as last read or written, without pictures; null when it must be read. */
  private current: Stored<T> | null = null;
  /** What the store holds as each element's picture, so a save leaves those off. */
  private readonly held = new PictureLedger();
  /** Element id → picture id, for every picture this page sent or read. */
  private readonly pictureOf = new Map<string, string>();
  /** Picture id → its data URL, for every picture the store is known to hold. */
  private readonly stored = new Map<string, string>();

  constructor({ slug, secret, fetch: send }: StoredCopyOptions) {
    this.base = `/store/v1/drawings/${slug}`;
    this.secret = secret;
    this.fetch = send ?? ((input, init) => fetch(input, init));
  }

  /** The copy, pictures in, tombstones kept; null when nothing is stored for the drawing. */
  async read(): Promise<{ rev: number; elements: T[] } | null> {
    const found = await this.readScene();
    if (found === null) return null;
    const elements: T[] = [];
    // One picture at a time: each is up to megabytes, and most are already here.
    for (const element of found.elements) {
      const pid = found.refs.get(element.id);
      const dataUrl = pid === undefined ? undefined : await this.picture(pid);
      if (pid !== undefined) this.pictureOf.set(element.id, pid);
      elements.push(dataUrl === undefined ? element : { ...element, dataUrl });
    }
    this.held.note(elements);
    return { rev: found.rev, elements };
  }

  /** Merges `patch` — this page's own edits — into the copy, its new pictures sent first. */
  async save(patch: ScenePatch<T>): Promise<void> {
    const incoming: T[] = [];
    const sent = new Map<string, string>();
    for (const element of this.held.strip(patch.elements)) {
      const { id, isDeleted, dataUrl } = pictured(element);
      if (!isDeleted && dataUrl !== undefined) {
        const pid = await this.sendPicture(dataUrl);
        this.pictureOf.set(id, pid);
        sent.set(id, pid);
      }
      incoming.push(withoutPicture(element));
    }

    // The rev a conflict named, for a copy that then reads as none: one a year unwritten,
    // which the store answers as a 404 until a write sweeps it.
    let named = 0;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const base = this.current ??
        (await this.readScene()) ?? { rev: named, elements: [], refs: new Map() };
      const merged = reconcileElements(base.elements, incoming).elements;
      const elements = patch.order === undefined ? merged : applyOrder(merged, patch.order);
      const refs = refsFor(elements, sent, this.pictureOf, base.refs);
      const written = await this.writeScene(await this.seal(elements, refs), base.rev);
      if (written.landed) {
        this.current = { rev: written.rev, elements, refs };
        this.held.note(patch.elements);
        return;
      }
      this.current = null;
      named = written.rev;
    }
    throw new ApiClientError(503, "busy", "other saves kept landing first; this one waits");
  }

  private key(): Promise<RoomKey> {
    this.sealing ??= importRoomKey(this.secret);
    return this.sealing;
  }

  private async headers(more: Record<string, string> = {}): Promise<Record<string, string>> {
    this.token ??= deriveWriteToken(this.secret);
    return {
      authorization: `Bearer ${await this.token}`,
      "content-type": "application/octet-stream",
      ...more,
    };
  }

  private async send(
    path: string,
    init: { method: string; headers?: Record<string, string>; body?: Uint8Array<ArrayBuffer> },
  ): Promise<Response> {
    const size = init.body?.byteLength ?? 0;
    try {
      return await this.fetch(`${this.base}${path}`, {
        ...init,
        keepalive: this.leaving && size <= KEEPALIVE_BYTES,
      });
    } catch {
      throw new ApiClientError(503, "store_unreachable", "the online copy could not be reached");
    }
  }

  /**
   * An item's bytes, every part: part 0 says how many there are. MOVED when a later part
   * is not part 0's write — gone, or another ETag — and null when nothing is stored.
   */
  private async readItem(
    path: string,
  ): Promise<{ bytes: Uint8Array; etag: string | null } | null | typeof MOVED> {
    const first = await this.send(path, { method: "GET" });
    if (first.status === 404) return null;
    if (!first.ok) throw await failed(first);
    const etag = first.headers.get("etag");
    const total = partsOf(first.headers.get("x-parts"));
    const parts = [new Uint8Array(await first.arrayBuffer())];
    for (let n = 1; n < total; n++) {
      const next = await this.send(`${path}/parts/${n}`, { method: "GET" });
      if (next.status === 404 || (next.ok && next.headers.get("etag") !== etag)) return MOVED;
      if (!next.ok) throw await failed(next);
      parts.push(new Uint8Array(await next.arrayBuffer()));
    }
    return { bytes: join(parts), etag };
  }

  private async readScene(): Promise<Stored<T> | null> {
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const item = await this.readItem("");
      if (item === MOVED) continue;
      if (item === null) return null;
      const rev = revOf(item.etag);
      const doc = await this.open(item.bytes);
      const found = { rev, elements: doc.elements, refs: new Map(Object.entries(doc.pictures)) };
      // A read slower than a save that followed it must not take the copy back.
      if (this.current === null || rev >= this.current.rev) this.current = found;
      return found;
    }
    throw new ApiClientError(503, "busy", "the online copy kept changing while it was read");
  }

  private async open(sealed: Uint8Array): Promise<CopyDocument<T>> {
    const opened = await openBytes(await this.key(), sealed);
    if (opened === null) throw unreadable();
    try {
      const doc: unknown = JSON.parse(textDecoder.decode(await decompress(opened)));
      if (isDocument(doc)) return doc as CopyDocument<T>;
    } catch {
      // Sealed under this secret yet not a copy: as unreadable as a wrong secret.
    }
    throw unreadable();
  }

  private async seal(elements: T[], refs: Map<string, string>): Promise<Uint8Array> {
    const doc: CopyDocument<T> = {
      type: "hydrawn-copy",
      version: 1,
      elements,
      pictures: Object.fromEntries(refs),
    };
    return sealBytes(await this.key(), await compress(textEncoder.encode(JSON.stringify(doc))));
  }

  /** Writes the scene on `rev`: landed with its new rev, or beaten by the rev that won. */
  private async writeScene(
    sealed: Uint8Array,
    rev: number,
  ): Promise<{ landed: boolean; rev: number }> {
    const parts = split(sealed);
    const ifMatch = { "if-match": String(rev) };
    let answer: Response | null = null;
    if (parts.length === 1) {
      answer = await this.send("", {
        method: "PUT",
        headers: await this.headers(ifMatch),
        body: parts[0],
      });
    } else {
      const staged = `/staged/${uploadId()}`;
      const count = { ...ifMatch, "x-parts": String(parts.length) };
      for (const [n, body] of parts.entries()) {
        const put = await this.send(`${staged}/parts/${n}`, {
          method: "PUT",
          headers: await this.headers(count),
          body,
        });
        if (!put.ok) {
          answer = put;
          break;
        }
      }
      answer ??= await this.send(staged, { method: "POST", headers: await this.headers(ifMatch) });
    }
    if (answer.ok) return { landed: true, rev: revOf(answer.headers.get("etag")) };
    const error = await failed(answer);
    if (error.status === 409 && error.code === "conflict") {
      return { landed: false, rev: revOf(answer.headers.get("etag")) };
    }
    throw error;
  }

  /** Sends a picture the store does not hold yet, under a fresh upload id; its id. */
  private async sendPicture(dataUrl: string): Promise<string> {
    const plain = pictureBytes(dataUrl);
    const pid = await pictureStoreId(this.secret, plain);
    if (this.stored.has(pid)) return pid;
    const parts = split(await sealBytes(await this.key(), plain));
    const path = parts.length === 1 ? `/pictures/${pid}` : `/pictures/${pid}/uploads/${uploadId()}`;
    const count: Record<string, string> =
      parts.length === 1 ? {} : { "x-parts": String(parts.length) };
    for (const [n, body] of parts.entries()) {
      const answer = await this.send(parts.length === 1 ? path : `${path}/parts/${n}`, {
        method: "PUT",
        headers: await this.headers(count),
        body,
      });
      if (answer.ok) continue;
      const error = await failed(answer);
      // Write-once: someone with the link sent this very picture first.
      if (error.status === 409 && error.code === "part_exists") break;
      throw error;
    }
    this.stored.set(pid, dataUrl);
    return pid;
  }

  /** A stored picture's data URL; undefined when the store has none under `pid`. */
  private async picture(pid: string): Promise<string | undefined> {
    const known = this.stored.get(pid);
    if (known !== undefined) return known;
    const item = await this.readItem(`/pictures/${pid}`);
    if (item === null || item === MOVED) return undefined;
    const opened = await openBytes(await this.key(), item.bytes);
    const dataUrl = opened === null ? null : pictureUrl(opened);
    if (dataUrl === null) throw unreadable();
    this.stored.set(pid, dataUrl);
    return dataUrl;
  }
}
