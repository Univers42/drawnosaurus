import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_THUMBNAIL_BYTES } from "@drawnosaurus/contract";
import { ThumbnailUploader } from "./thumbnailUploader.ts";

const png = (size = 100): Blob => new Blob([new Uint8Array(size)], { type: "image/png" });

function setup(
  overrides: { render?: () => Promise<Blob | null>; upload?: () => Promise<void> } = {},
) {
  const render = vi.fn(overrides.render ?? (async () => png()));
  const upload = vi.fn(overrides.upload ?? (async () => undefined));
  const uploader = new ThumbnailUploader({ render, upload, now: () => Date.now() });
  return { render, upload, uploader };
}

/** One autosave that landed: the status the page reports on `saving` then `idle`. */
const saved = (uploader: ThumbnailUploader): void => {
  uploader.noteChanged();
  uploader.onStatus("pending", "saving");
  uploader.onStatus("saving", "idle");
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ThumbnailUploader", () => {
  it("uploads once, 3s after the save lands, however many saves came before", async () => {
    const { upload, uploader } = setup();
    saved(uploader);
    await vi.advanceTimersByTimeAsync(2_000);
    saved(uploader);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(upload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("arms only on saving to idle, not on pending, error or idle to idle", async () => {
    const { upload, uploader } = setup();
    uploader.noteChanged();
    uploader.onStatus("idle", "pending");
    uploader.onStatus("saving", "error");
    uploader.onStatus("idle", "idle");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(upload).not.toHaveBeenCalled();
  });

  it("does nothing when nothing changed since the last upload", async () => {
    const { render, upload, uploader } = setup();
    uploader.onStatus("saving", "idle");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(render).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it("runs one upload at a time", async () => {
    let release: () => void = () => undefined;
    const { upload, uploader } = setup({
      upload: () => new Promise<void>((resolve) => (release = resolve)),
    });
    saved(uploader);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(upload).toHaveBeenCalledTimes(1);

    saved(uploader);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(upload).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("keeps uploads at least 10s apart", async () => {
    const { upload, uploader } = setup();
    saved(uploader);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(upload).toHaveBeenCalledTimes(1);

    saved(uploader);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(upload).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(7_000);
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("skips a null render without uploading", async () => {
    const { upload, uploader } = setup({ render: async () => null });
    saved(uploader);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(upload).not.toHaveBeenCalled();
  });

  it("skips a blob over the limit and keeps the old picture", async () => {
    const { upload, uploader } = setup({ render: async () => png(MAX_THUMBNAIL_BYTES + 1) });
    saved(uploader);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(upload).not.toHaveBeenCalled();
  });

  it("uploads a blob of exactly the limit", async () => {
    const { upload, uploader } = setup({ render: async () => png(MAX_THUMBNAIL_BYTES) });
    saved(uploader);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("swallows a failed upload, stays dirty, and retries on the next save", async () => {
    const upload = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const uploader = new ThumbnailUploader({ render: async () => png(), upload, now: Date.now });

    saved(uploader);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(upload).toHaveBeenCalledTimes(1);

    // Dirty still: a save with no new noteChanged() retries.
    uploader.onStatus("saving", "idle");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(upload).toHaveBeenCalledTimes(2);

    uploader.onStatus("saving", "idle");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("flushNow uploads at once when dirty, ignoring the debounce and the spacing", async () => {
    const { upload, uploader } = setup();
    saved(uploader);
    await vi.advanceTimersByTimeAsync(3_000);
    uploader.noteChanged();
    await uploader.flushNow();
    expect(upload).toHaveBeenCalledTimes(2);

    await uploader.flushNow();
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("backfill uploads once for a board that has none", async () => {
    const { upload, uploader } = setup();
    uploader.backfill();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(upload).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("dispose cancels a pending upload", async () => {
    const { upload, uploader } = setup();
    saved(uploader);
    uploader.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(upload).not.toHaveBeenCalled();
  });
});
