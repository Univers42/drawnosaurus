import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { handle } from "@drawnosaurus/store/handlers";
import { EXPIRY_MS, PART_BYTES } from "@drawnosaurus/store/limits";
import { memoryStore } from "@drawnosaurus/store/memory";
import type { StampedElement } from "../autosave/sceneDiff.ts";

// `api/client.ts` (for `ApiClientError`) reads the runtime config, which reads this
// SvelteKit virtual module; vitest has no resolver for it. See `config.test.ts`.
vi.mock("$env/dynamic/public", () => ({ env: {} }));

const { ApiClientError } = await import("../api/client.ts");
const { classifyShared, StoredCopy } = await import("./storedCopy.ts");

interface Shape extends StampedElement {
  type: string;
  text?: string;
  dataUrl?: string;
}

const SLUG = "sharedsharedsharedshared12";

const shape = (id: string, version = 1, more: Partial<Shape> = {}): Shape => ({
  id,
  type: "rectangle",
  version,
  versionNonce: version * 10,
  updated: version,
  isDeleted: false,
  ...more,
});

/** A picture as the app holds one: a base64 `data:` URL of `bytes` random bytes. */
const picture = (bytes: number): string =>
  `data:image/png;base64,${randomBytes(bytes).toString("base64")}`;

const image = (id: string, dataUrl: string, version = 1): Shape =>
  shape(id, version, { type: "image", dataUrl });

const secret = () => new Uint8Array(randomBytes(32));

interface Sent {
  method: string;
  path: string;
  headers: Headers;
  body: Buffer;
  keepalive: boolean;
}

/**
 * The store's own handlers over its in-memory database, standing in for the network: every
 * request the copy makes is answered as the Pages Function would answer it, and recorded.
 * `before` runs ahead of each request and may answer it instead, or fail it as a dropped
 * connection does.
 */
function network(db = memoryStore()) {
  const sent: Sent[] = [];
  let now = Date.now();
  let before: ((request: Sent) => Promise<Response | undefined> | Response | undefined) | null =
    null;
  const fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input, "https://hydrawn.test");
    const body = init.body ? Buffer.from(init.body as Uint8Array) : Buffer.alloc(0);
    const request: Sent = {
      method: init.method ?? "GET",
      path: url.pathname,
      headers: new Headers(init.headers),
      body,
      keepalive: init.keepalive === true,
    };
    sent.push(request);
    const instead = await before?.(request);
    if (instead) return instead;
    return handle(
      new Request(url, {
        method: request.method,
        headers: request.headers,
        body: body.byteLength > 0 ? body : null,
      }),
      db,
      now,
    );
  };
  return {
    db,
    fetch,
    sent,
    intercept: (next: typeof before) => {
      before = next;
    },
    later: (ms: number) => {
      now += ms;
    },
  };
}

const copyOf = (net: ReturnType<typeof network>, raw: Uint8Array) =>
  new StoredCopy<Shape>({ slug: SLUG, secret: raw, fetch: net.fetch });

const ids = (elements: readonly { id: string }[]) => elements.map((element) => element.id).sort();

/** What a rejection was, as the page's `classify` sees it. */
async function failure(promise: Promise<unknown>): Promise<InstanceType<typeof ApiClientError>> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiClientError);
    return error as InstanceType<typeof ApiClientError>;
  }
  throw new Error("expected a rejection");
}

describe("StoredCopy", () => {
  it("is nothing for a drawing never saved online", async () => {
    expect(await copyOf(network(), secret()).read()).toBeNull();
  });

  it("is read back whole by anyone else holding the link", async () => {
    const net = network();
    const raw = secret();
    await copyOf(net, raw).save({ elements: [shape("a"), shape("b", 2, { text: "hello" })] });

    const read = await copyOf(net, raw).read();

    expect(read?.elements).toEqual([shape("a"), shape("b", 2, { text: "hello" })]);
    expect(read?.rev).toBe(1);
  });

  it("brings two interleaved writers to the same drawing", async () => {
    // Both read rev 1, then both write: the second write is a 409, read again, merged by
    // the contract's rule, written again. Each keeps the other's edit and the newer stamp.
    const net = network();
    const raw = secret();
    await copyOf(net, raw).save({ elements: [shape("shared", 1)] });
    const ana = copyOf(net, raw);
    const ben = copyOf(net, raw);
    await ana.read();
    await ben.read();

    await ana.save({ elements: [shape("ana"), shape("shared", 2)] });
    await ben.save({ elements: [shape("ben"), shape("shared", 3)] });
    await ana.save({ elements: [shape("ana", 2)] });

    const seen = [await copyOf(net, raw).read(), await ana.read(), await ben.read()];
    for (const read of seen) {
      expect(ids(read!.elements)).toEqual(["ana", "ben", "shared"]);
      expect(read!.elements.find((element) => element.id === "shared")?.version).toBe(3);
      expect(read!.elements.find((element) => element.id === "ana")?.version).toBe(2);
    }
    // The first write, Ana's, Ben's twice and Ana's twice: each of theirs met the other's.
    expect(net.sent.filter((request) => request.method === "PUT")).toHaveLength(6);
  });

  it("sends a picture once, however often its image is saved", async () => {
    const net = network();
    const raw = secret();
    const copy = copyOf(net, raw);
    const photo = picture(2000);

    await copy.save({ elements: [image("img", photo, 1)] });
    // Moved, twice: the image changes, its picture does not.
    await copy.save({ elements: [image("img", photo, 2)] });
    await copy.save({ elements: [{ ...image("img", photo, 3), dataUrl: undefined }] });

    const pictures = net.sent.filter((request) => request.path.includes("/pictures/"));
    expect(pictures.map((request) => request.method)).toEqual(["PUT"]);
    const read = await copyOf(net, raw).read();
    expect(read?.elements).toEqual([image("img", photo, 3)]);
  });

  it("takes a picture another browser already sent as stored, and sends it no further", async () => {
    // One picture, the same name from both: the second upload is the store's write-once
    // 409, which means the copy is there.
    const net = network();
    const raw = secret();
    const photo = picture(PART_BYTES + 1000);
    await copyOf(net, raw).save({ elements: [image("mine", photo)] });

    const other = copyOf(net, raw);
    await other.save({ elements: [image("theirs", photo)] });

    const read = await copyOf(net, raw).read();
    expect(read?.elements.map((element) => element.dataUrl)).toEqual([photo, photo]);
  });

  it("sends a picture sealed again under a new upload id, after an attempt that failed", async () => {
    const net = network();
    const raw = secret();
    const copy = copyOf(net, raw);
    const photo = picture(2 * PART_BYTES + 5000);
    let parts = 0;
    net.intercept((request) => {
      // The link drops after the first part of the first attempt.
      if (request.path.includes("/uploads/") && ++parts === 2) throw new TypeError("offline");
      return undefined;
    });

    expect((await failure(copy.save({ elements: [image("img", photo)] }))).status).toBe(503);
    net.intercept(null);
    await copy.save({ elements: [image("img", photo)] });

    const uploads = net.sent
      .filter((request) => request.path.includes("/uploads/"))
      .map((request) => /\/uploads\/([^/]+)\//.exec(request.path)?.[1]);
    expect(new Set(uploads).size).toBe(2);
    expect((await copyOf(net, raw).read())?.elements[0]?.dataUrl).toBe(photo);
  });

  it("sends nothing the store could read: no text, no element id, no plain picture name", async () => {
    const net = network();
    const raw = secret();
    const marker = "MARKER_PLAINTEXT_CAT";
    const photo = picture(3000);
    const bytes = Buffer.from(photo.slice(photo.indexOf(",") + 1), "base64");

    await copyOf(net, raw).save({
      elements: [shape("elementidmarker", 1, { text: marker }), image("imageidmarker", photo)],
    });

    const hashes = [
      createHash("sha256").update(bytes).digest("hex"),
      createHash("sha256").update(photo).digest("hex"),
    ];
    for (const request of net.sent) {
      const wire = `${request.path} ${[...request.headers.values()].join(" ")}`;
      for (const plain of [marker, "elementidmarker", "imageidmarker"]) {
        expect(wire).not.toContain(plain);
        expect(request.body.includes(Buffer.from(plain))).toBe(false);
      }
      for (const hash of hashes) expect(wire).not.toContain(hash.slice(0, 16));
      expect(request.body.includes(bytes.subarray(0, 64))).toBe(false);
    }
    // And a picture's name says nothing of the picture without the secret.
    const named = net.sent.find((request) => request.path.includes("/pictures/"))!.path;
    const other = network();
    await copyOf(other, secret()).save({ elements: [image("imageidmarker", photo)] });
    expect(other.sent.find((request) => request.path.includes("/pictures/"))!.path).not.toBe(named);
  });

  it("sends a scene larger than one part staged, then made current by one commit", async () => {
    const net = network();
    const raw = secret();
    // Random text compresses little: the sealed scene is over one part and under two.
    const big = shape("big", 1, { text: randomBytes(1.5 * PART_BYTES).toString("base64") });

    await copyOf(net, raw).save({ elements: [big] });

    const writes = net.sent.filter((request) => request.method !== "GET");
    const route = (path: string) =>
      path.replace(SLUG, ":id").replace(/\/staged\/[a-z0-9]+/, "/staged/:sid");
    expect(writes.map((request) => `${request.method} ${route(request.path)}`)).toEqual([
      "PUT /store/v1/drawings/:id/staged/:sid/parts/0",
      "PUT /store/v1/drawings/:id/staged/:sid/parts/1",
      "POST /store/v1/drawings/:id/staged/:sid",
    ]);
    expect((await copyOf(net, raw).read())?.elements).toEqual([big]);
  });

  it("reads again from the start when a later part belongs to a newer write", async () => {
    const net = network();
    const raw = secret();
    const writer = copyOf(net, raw);
    const text = () => randomBytes(1.5 * PART_BYTES).toString("base64");
    await writer.save({ elements: [shape("big", 1, { text: text() })] });
    const newer = shape("big", 2, { text: text() });
    let interleaved = false;
    net.intercept(async (request) => {
      // Between the reader's part 0 and part 1, the writer replaces the scene.
      if (!interleaved && request.method === "GET" && request.path.endsWith("/parts/1")) {
        interleaved = true;
        net.intercept(null);
        await writer.save({ elements: [newer] });
      }
      return undefined;
    });

    const read = await copyOf(net, raw).read();

    expect(interleaved).toBe(true);
    expect(read?.elements).toEqual([newer]);
    expect(read?.rev).toBe(2);
  });

  it("reads again on a conflict at most five times, then gives up for a later retry", async () => {
    const net = network();
    const copy = copyOf(net, secret());
    await copy.save({ elements: [shape("a")] });
    // Someone else's write always lands first.
    net.intercept((request) =>
      request.method === "PUT"
        ? Response.json(
            { error: { code: "conflict", message: "moved on" } },
            { status: 409, headers: { etag: '"1"' } },
          )
        : undefined,
    );

    const refused = await failure(copy.save({ elements: [shape("b")] }));

    expect(refused.status).toBe(503);
    expect(classifyShared(refused)).toBe("retry");
    expect(net.sent.filter((request) => request.method === "PUT")).toHaveLength(1 + 5);
  });

  it("revives a copy a year unwritten that nobody swept: a 404, then a 409, is read again", async () => {
    // The store answers a drawing past its expiry with a 404 at once, but only a write
    // sweeps it: creating it again is a 409 on the old rev (the store review's M2).
    const net = network();
    const raw = secret();
    await copyOf(net, raw).save({ elements: [shape("old")] });
    net.later(EXPIRY_MS + 1);

    const copy = copyOf(net, raw);
    expect(await copy.read()).toBeNull();
    await copy.save({ elements: [shape("new")] });

    expect(ids((await copyOf(net, raw).read())!.elements)).toEqual(["new"]);
  });

  it("says a drawing too large for its online copy is too large, as the Docker build does", async () => {
    const net = network();
    const copy = copyOf(net, secret());
    const photos = [1, 2, 3].map((n) => image(`p${n}`, picture(4 * 1024 * 1024 - 100)));

    const refused = await failure(copy.save({ elements: photos }));

    expect(refused.status).toBe(413);
    expect(classifyShared(refused)).toBe("too-large");
  });

  it("says a scene over the store's most parts is too large, without sending it", async () => {
    const net = network();
    const huge = shape("huge", 1, { text: randomBytes(11 * PART_BYTES).toString("base64") });

    const refused = await failure(copyOf(net, secret()).save({ elements: [huge] }));

    expect(refused.status).toBe(413);
    expect(net.sent.filter((request) => request.method !== "GET")).toEqual([]);
  });

  it("says a link that cannot write this drawing cannot, and does not retry it", async () => {
    const net = network();
    await copyOf(net, secret()).save({ elements: [shape("a")] });
    // The same drawing, another secret: its token is not the one the first write proved.
    const stranger = copyOf(net, secret());
    net.intercept((request) =>
      // It cannot read the copy either; let it think there is none, to reach the write.
      request.method === "GET" ? new Response(null, { status: 404 }) : undefined,
    );

    const refused = await failure(stranger.save({ elements: [shape("b")] }));

    expect(refused.status).toBe(403);
    expect(classifyShared(refused)).toBe("refused");
  });

  it("says the copy is unavailable when the store is down or the network is", async () => {
    const net = network();
    const copy = copyOf(net, secret());
    net.intercept(() =>
      Response.json({ error: { code: "store_unavailable", message: "spent" } }, { status: 503 }),
    );
    const down = await failure(copy.save({ elements: [shape("a")] }));
    net.intercept(() => {
      throw new TypeError("Failed to fetch");
    });
    const offline = await failure(copy.save({ elements: [shape("a")] }));
    const unreadable = await failure(copy.read());

    for (const error of [down, offline, unreadable]) {
      expect(error.status).toBe(503);
      expect(classifyShared(error)).toBe("retry");
    }
  });

  it("asks for keepalive while the page is leaving, for a request of 64 KB or less only", async () => {
    const net = network();
    const copy = copyOf(net, secret());
    copy.leaving = true;

    await copy.save({ elements: [shape("small")] });
    await copy.save({ elements: [image("img", picture(100 * 1024))] });

    const writes = net.sent.filter((request) => request.method === "PUT");
    expect(
      writes.map((request) => [request.body.byteLength <= 64 * 1024, request.keepalive]),
    ).toEqual([
      [true, true],
      [false, false],
      [true, true],
    ]);
    copy.leaving = false;
    await copy.save({ elements: [shape("small", 2)] });
    expect(net.sent.at(-1)?.keepalive).toBe(false);
  });
});
