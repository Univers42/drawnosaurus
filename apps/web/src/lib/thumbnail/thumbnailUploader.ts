import { MAX_THUMBNAIL_BYTES } from "@drawnosaurus/contract";
import type { AutosaveStatus } from "../autosave/autosaver.ts";

/**
 * Keeps the board's gallery picture current: after an autosave lands, a few seconds
 * later, the engine renders a thumbnail and it is uploaded.
 *
 * Caveat: best effort, and stale in three known ways. A tab closed within 3s of the last
 * save leaves the previous picture (the `visibilitychange` flush covers a hide, not a
 * killed tab). Edits made inside the 10s spacing wait for it, so the picture can trail the
 * board by that long. A board whose PNG is over `MAX_THUMBNAIL_BYTES` is skipped and keeps
 * its old picture, or none. A failed upload is not retried on a timer: the next save or
 * hide retries it. Only the client that saved uploads, so a board edited by peers only
 * shows the picture of whoever saved last.
 */

/** Quiet time after a save lands, so a burst of strokes costs one upload. */
const DEBOUNCE_MS = 3_000;
/** Floor between two uploads, so a long drawing session does not stream PNGs. */
const MIN_GAP_MS = 10_000;

export interface ThumbnailUploaderDeps {
  render: () => Promise<Blob | null>;
  upload: (blob: Blob) => Promise<void>;
  now: () => number;
}

export class ThumbnailUploader {
  private readonly deps: ThumbnailUploaderDeps;
  private dirty = false;
  private inFlight = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastAttemptAt = Number.NEGATIVE_INFINITY;
  private disposed = false;

  constructor(deps: ThumbnailUploaderDeps) {
    this.deps = deps;
  }

  /** The scene changed: the stored picture is out of date. */
  noteChanged(): void {
    this.dirty = true;
  }

  /** Arms the debounce when a save lands; the other transitions mean nothing landed. */
  onStatus(previous: AutosaveStatus, next: AutosaveStatus): void {
    if (previous === "saving" && next === "idle") this.schedule();
  }

  /** A board with elements and no picture yet gets one without waiting for an edit. */
  backfill(): void {
    this.dirty = true;
    this.schedule();
  }

  /** For `visibilitychange` to hidden: no debounce, no spacing. */
  async flushNow(): Promise<void> {
    this.cancelTimer();
    await this.run();
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
  }

  private schedule(): void {
    if (this.disposed) return;
    this.cancelTimer();
    const wait = Math.max(DEBOUNCE_MS, this.lastAttemptAt + MIN_GAP_MS - this.deps.now());
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.run();
    }, wait);
  }

  private cancelTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async run(): Promise<void> {
    if (this.disposed || this.inFlight || !this.dirty) return;
    this.inFlight = true;
    // Cleared before the render so an edit during it marks the picture dirty again.
    this.dirty = false;
    this.lastAttemptAt = this.deps.now();
    let failed = false;
    try {
      const blob = await this.deps.render();
      if (blob === null || blob.size > MAX_THUMBNAIL_BYTES) return;
      await this.deps.upload(blob);
    } catch (cause) {
      failed = true;
      this.dirty = true;
      console.debug("thumbnail upload failed; the next save retries", cause);
    } finally {
      this.inFlight = false;
      // An edit that landed mid-flight; a failure waits for the next save instead.
      if (this.dirty && !failed) this.schedule();
    }
  }
}
