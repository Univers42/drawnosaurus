import { describe, expect, it, vi } from "vitest";
import { cardPicture } from "./cardPicture.ts";

/** Picture reads that settle only when the test says so. */
function reads() {
  const pending: {
    version: string;
    settle: (url: string | null) => void;
    fail: (error: Error) => void;
  }[] = [];
  const read = (_slug: string, version: string) =>
    new Promise<string | null>((settle, fail) => pending.push({ version, settle, fail }));
  const at = (version: string) => {
    const found = pending.find((entry) => entry.version === version);
    if (!found) throw new Error(`no read of ${version}`);
    return found;
  };
  return { read, pending, at };
}

/** As much of an `<img>` as the action touches. */
function image() {
  const node = Object.assign(new EventTarget(), { src: "" });
  const errors = vi.fn();
  node.addEventListener("error", errors);
  return { node, img: node as unknown as HTMLImageElement, errors };
}

const settledReads = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("cardPicture", () => {
  it("shows the address the store gave", async () => {
    const { read, at } = reads();
    const release = vi.fn();
    const { node, img } = image();

    cardPicture(read, release)(img, { slug: "s", version: "v1" });
    at("v1").settle("blob:one");
    await settledReads();

    expect(node.src).toBe("blob:one");
    expect(release).not.toHaveBeenCalled();
  });

  it("releases the old address when a newer picture replaces it", async () => {
    const { read, at } = reads();
    const release = vi.fn();
    const { node, img } = image();
    const action = cardPicture(read, release)(img, { slug: "s", version: "v1" });
    at("v1").settle("blob:one");
    await settledReads();

    action.update({ slug: "s", version: "v2" });
    at("v2").settle("blob:two");
    await settledReads();

    expect(node.src).toBe("blob:two");
    expect(release.mock.calls).toEqual([["blob:one"]]);
  });

  it("does not read again for the same picture", () => {
    const { read, pending } = reads();
    const action = cardPicture(read, vi.fn())(image().img, { slug: "s", version: "v1" });

    action.update({ slug: "s", version: "v1" });

    expect(pending).toHaveLength(1);
  });

  it("releases its address when the card goes", async () => {
    const { read, at } = reads();
    const release = vi.fn();
    const action = cardPicture(read, release)(image().img, { slug: "s", version: "v1" });
    at("v1").settle("blob:one");
    await settledReads();

    action.destroy();

    expect(release.mock.calls).toEqual([["blob:one"]]);
  });

  it("releases an address that arrives after the card is gone", async () => {
    const { read, at } = reads();
    const release = vi.fn();
    const { node, img } = image();
    const action = cardPicture(read, release)(img, { slug: "s", version: "v1" });

    action.destroy();
    at("v1").settle("blob:late");
    await settledReads();

    expect(release.mock.calls).toEqual([["blob:late"]]);
    expect(node.src).toBe("");
  });

  it("releases an address for a picture already replaced, whichever read lands first", async () => {
    const { read, at } = reads();
    const release = vi.fn();
    const { node, img } = image();
    const action = cardPicture(read, release)(img, { slug: "s", version: "v1" });
    action.update({ slug: "s", version: "v2" });

    at("v2").settle("blob:two");
    await settledReads();
    at("v1").settle("blob:one");
    await settledReads();

    expect(node.src).toBe("blob:two");
    expect(release.mock.calls).toEqual([["blob:one"]]);
    action.destroy();
    expect(release.mock.calls).toEqual([["blob:one"], ["blob:two"]]);
  });

  it("falls back as a broken picture does when there is none, or it cannot be read", async () => {
    const { read, at } = reads();
    const missing = image();
    const failing = image();
    const load = cardPicture(read, vi.fn());

    load(missing.img, { slug: "a", version: "none" });
    load(failing.img, { slug: "b", version: "broken" });
    at("none").settle(null);
    at("broken").fail(new Error("the database is gone"));
    await settledReads();

    expect(missing.errors).toHaveBeenCalledTimes(1);
    expect(failing.errors).toHaveBeenCalledTimes(1);
    expect([missing.node.src, failing.node.src]).toEqual(["", ""]);
  });
});
