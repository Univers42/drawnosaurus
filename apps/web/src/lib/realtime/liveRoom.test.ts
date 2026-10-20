import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveBoardRoomKeyBytes, parseRoomKeyFromHash } from "./roomCrypto.ts";
import { liveKeyFor } from "./liveRoom.ts";

const at = (hash = "") => ({ hash, pathname: "/boards/mine1", search: "" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("liveKeyFor", () => {
  it("gives the Docker build the board's key, written into the address, as before", async () => {
    const replaceState = vi.fn();
    vi.stubGlobal("history", { replaceState });

    const key = await liveKeyFor({ browser: false, slug: "mine1", location: at() });

    expect(key).toEqual(await deriveBoardRoomKeyBytes("mine1"));
    expect(replaceState).toHaveBeenCalledTimes(1);
    const written = String(replaceState.mock.calls[0]?.[2]);
    expect(parseRoomKeyFromHash(written.slice(written.indexOf("#")))).toEqual(key);
  });

  it("gives the public build no key, and writes none anywhere, for a drawing not shared", async () => {
    const replaceState = vi.fn();
    const setItem = vi.fn();
    vi.stubGlobal("history", { replaceState });
    vi.stubGlobal("localStorage", { setItem, getItem: () => null });

    const key = await liveKeyFor({ browser: true, slug: "mine1", location: at() });

    expect(key).toBeNull();
    expect(replaceState).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });
});
