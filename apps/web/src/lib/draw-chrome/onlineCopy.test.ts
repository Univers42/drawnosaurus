import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle } from "@drawnosaurus/store/handlers";
import { memoryStore } from "@drawnosaurus/store/memory";
import type { ScenePatch, StampedElement } from "../autosave/sceneDiff.ts";
import type { OnlineCopyStore } from "./onlineCopy.ts";

// `api/client.ts` (for `ApiClientError`) reads the runtime config, which reads this
// SvelteKit virtual module; vitest has no resolver for it. See `config.test.ts`.
vi.mock("$env/dynamic/public", () => ({ env: {} }));

const { StoredCopy: Copy } = await import("../sharing/storedCopy.ts");
const { OnlineCopy, ONLINE_COPY_THROTTLE_MS } = await import("./onlineCopy.ts");

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

const secret = () => new Uint8Array(randomBytes(32));

/**
 * The store's own handlers over its in-memory database, standing in for the network: every
 * request the copy makes is answered as the Pages Function would answer it.
 */
function network() {
  const db = memoryStore();
  const sent: { method: string; path: string; keepalive: boolean }[] = [];
  const fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input, "https://hydrawn.test");
    const body = init.body ? Buffer.from(init.body as Uint8Array) : Buffer.alloc(0);
    sent.push({
      method: init.method ?? "GET",
      path: url.pathname,
      keepalive: init.keepalive === true,
    });
    return handle(
      new Request(url, {
        method: init.method ?? "GET",
        headers: new Headers(init.headers),
        body: body.byteLength > 0 ? body : null,
      }),
      db,
    );
  };
  return { db, fetch, sent };
}

/** The page that saves the copy: the scene it holds, and the copy it writes to. */
function page(copy: OnlineCopyStore<Shape>, scene: Shape[] = []) {
  let held = scene;
  const online = new OnlineCopy<Shape>({
    slug: SLUG,
    copy,
    readScene: () => held,
    lookup: (id) => held.find((element) => element.id === id),
  });
  const put = (element: Shape) => {
    held = held.map((one) => (one.id === element.id ? element : one));
    if (!held.some((one) => one.id === element.id)) held = [...held, element];
  };
  return {
    online,
    /** This page's own edit. */
    edit: (element: Shape) => {
      put(element);
      online.noteChanged([element.id]);
    },
    /** A peer's edit: in the scene, and not this page's to write. */
    peer: put,
    scene: () => held,
  };
}

/** What the store holds, read back with the same secret. */
async function stored(net: ReturnType<typeof network>, raw: Uint8Array) {
  const read = await new Copy<Shape>({ slug: SLUG, secret: raw, fetch: net.fetch }).read();
  return read?.elements ?? [];
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("OnlineCopy", () => {
  it("writes the whole scene as the drawing's first copy, and does not write it again", async () => {
    const net = network();
    const raw = secret();
    const copy = new Copy<Shape>({ slug: SLUG, secret: raw, fetch: net.fetch });
    const { online } = page(copy, [shape("a"), shape("b")]);

    await online.writeFirstCopy();

    expect(await stored(net, raw)).toEqual([shape("a"), shape("b")]);
    const before = net.sent.length;
    // The copy holds the scene, so the saver must not send it again.
    await online.saveNow();
    expect(net.sent.length, "the copy was written twice").toBe(before);
  });

  it("writes this page's own edits, and leaves a peer's edit to the peer", async () => {
    const net = network();
    const raw = secret();
    const copy = new Copy<Shape>({ slug: SLUG, secret: raw, fetch: net.fetch });
    const { online, peer, edit } = page(copy, [shape("a")]);
    await online.writeFirstCopy();

    // A peer's edit: it is in the scene, and this page never notes it as its own.
    peer(shape("peer", 2));
    await online.saveNow();
    expect(await stored(net, raw), "a peer's edit was written here").toEqual([shape("a")]);

    // This page's own edit.
    edit(shape("a", 3));
    await online.saveNow();

    const held = await stored(net, raw);
    expect(held.find((element) => element.id === "a")?.version).toBe(3);
    expect(
      held.some((element) => element.id === "peer"),
      "the peer's edit again",
    ).toBe(false);
  });

  it("writes at most once every 20 seconds while the edits keep coming", async () => {
    // A copy that answers at once: the clock is the only thing under test here.
    const writes: ScenePatch<Shape>[] = [];
    const copy = {
      leaving: false,
      save: async (patch: ScenePatch<Shape>) => {
        writes.push(patch);
      },
    };
    const { edit } = page(copy, [shape("a")]);

    for (let second = 0; second < 60; second += 1) {
      edit(shape("a", second + 2));
      await vi.advanceTimersByTimeAsync(1000);
    }
    await vi.advanceTimersByTimeAsync(60_000);

    // One edit a second for a minute is three throttled writes, not sixty.
    expect(writes).toHaveLength(3);
    expect(ONLINE_COPY_THROTTLE_MS).toBe(20_000);
  });

  it("sends what is left when the page is hidden, on a keepalive request", async () => {
    const net = network();
    const raw = secret();
    const copy = new Copy<Shape>({ slug: SLUG, secret: raw, fetch: net.fetch });
    const { online, edit } = page(copy, [shape("a")]);
    await online.writeFirstCopy();
    edit(shape("a", 2));

    await online.leave();

    const writes = net.sent.filter((request) => request.method === "PUT");
    expect(writes.length, "the pending edit was not sent").toBeGreaterThan(0);
    expect(writes.at(-1)?.keepalive, "a leaving request must ride keepalive").toBe(true);
  });
});
