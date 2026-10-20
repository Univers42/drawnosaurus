import { describe, expect, it, vi } from "vitest";
import { formatRoomHash, parseRoomKeyFromHash } from "../realtime/roomCrypto.ts";
import type { SecretStore } from "../store/types.ts";
import { drawingSecret, shareLink } from "./secret.ts";

const minted = () => crypto.getRandomValues(new Uint8Array(32));

/** A secret store over a map, its writes counted. */
function secrets(held: Record<string, Uint8Array> = {}) {
  const map = new Map(Object.entries(held));
  const store = {
    secret: vi.fn(async (slug: string) => map.get(slug) ?? null),
    keepSecret: vi.fn(async (slug: string, raw: Uint8Array) => {
      map.set(slug, raw);
    }),
  } satisfies SecretStore;
  return store;
}

describe("drawingSecret", () => {
  it("keeps the secret a drawing was shared with, whatever a link says", async () => {
    // A link to one of your drawings, with someone else's secret in it, must not take it
    // over: the drawing's own secret wins, and the other is not saved.
    const own = minted();
    const store = secrets({ mine1: own });

    const secret = await drawingSecret(store, "mine1", formatRoomHash(minted()));

    expect(secret).toEqual(own);
    expect(store.keepSecret).not.toHaveBeenCalled();
  });

  it("adopts a link's secret when the drawing has none, and saves it once", async () => {
    const linked = minted();
    const store = secrets();

    expect(await drawingSecret(store, "theirs1", formatRoomHash(linked))).toEqual(linked);
    expect(await drawingSecret(store, "theirs1", formatRoomHash(linked))).toEqual(linked);

    expect(store.keepSecret).toHaveBeenCalledTimes(1);
    expect(store.keepSecret).toHaveBeenCalledWith("theirs1", linked);
  });

  it("is none for a drawing not shared, opened without a link, and saves nothing", async () => {
    const store = secrets();

    expect(await drawingSecret(store, "alone1", "")).toBeNull();
    expect(await drawingSecret(store, "alone1", "#room=not-a-key")).toBeNull();
    expect(store.keepSecret).not.toHaveBeenCalled();
  });
});

describe("shareLink", () => {
  it("is the drawing's address with its secret in the fragment, which no server is sent", () => {
    const secret = minted();

    const link = shareLink("https://hydrawn-app.pages.dev", "abcdefghijklmnopqrstuvwxyz", secret);

    const url = new URL(link);
    expect(`${url.origin}${url.pathname}${url.search}`).toBe(
      "https://hydrawn-app.pages.dev/boards/abcdefghijklmnopqrstuvwxyz",
    );
    expect(parseRoomKeyFromHash(url.hash)).toEqual(secret);
    expect(url.hash).toBe(formatRoomHash(secret));
  });
});
