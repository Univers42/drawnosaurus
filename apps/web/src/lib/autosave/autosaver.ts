import { SceneDiffTracker, type ScenePatch, type StampedElement } from "./sceneDiff.ts";

/**
 * Drives the diff to the server: debounce, one request in flight, retry with
 * backoff.
 *
 * Typing produces a scene-change event per keystroke, so the debounce is what keeps
 * this from becoming one request per character. The single-flight rule matters more
 * than it looks: two overlapping PATCHes would both be merged server-side, but the
 * second would be built from a tracker that had not yet learned what the first sent,
 * so it would resend the same elements.
 */

/**
 * `error` is a failure worth retrying — offline, a 5xx. `too-large` and `refused` are
 * answers: the server will refuse the same patch again, so it is not retried until
 * something changes.
 */
export type AutosaveStatus = "idle" | "pending" | "saving" | "error" | "too-large" | "refused";

/** What a failed send means, as far as retrying goes. */
export type FailureKind = "retry" | "too-large" | "refused";

export interface AutosaverOptions<T extends StampedElement> {
  readScene: () => readonly T[];
  send: (patch: ScenePatch<T>) => Promise<void>;
  onStatus?: (status: AutosaveStatus) => void;
  /**
   * Tells a failure worth retrying from a final answer. Without it every failure was
   * retried, forever: a board over its size limit was sent again every thirty seconds
   * for as long as the tab stayed open, each attempt refused the same way.
   */
  classify?: (error: unknown) => FailureKind;
  debounceMs?: number;
  now?: () => number;
  nonce?: () => number;
}

const DEFAULT_DEBOUNCE_MS = 800;
const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

const randomNonce = (): number => Math.floor(Math.random() * 0x7fffffff);

export class SceneAutosaver<T extends StampedElement> {
  readonly tracker = new SceneDiffTracker<T>();

  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  /** A change arrived while a request was in flight — run again when it lands. */
  private dirty = false;
  private retryMs = FIRST_RETRY_MS;
  private disposed = false;
  private readonly options: AutosaverOptions<T>;

  constructor(options: AutosaverOptions<T>) {
    this.options = options;
  }

  /** The scene changed. Cheap to call on every engine event. */
  notify(): void {
    if (this.disposed) return;

    if (this.inFlight) {
      this.dirty = true;
      return;
    }

    this.setStatus("pending");
    this.arm(this.options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
  }

  /** Send immediately — for page-hide, navigation, or an explicit save. */
  async flush(): Promise<void> {
    this.clearTimer();
    await this.run();
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
  }

  private arm(delay: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async run(): Promise<void> {
    if (this.disposed || this.inFlight) return;

    const now = this.options.now ?? Date.now;
    const nonce = this.options.nonce ?? randomNonce;
    const patch = this.tracker.diff(this.options.readScene(), now(), nonce);

    if (patch === null) {
      this.setStatus("idle");
      return;
    }

    this.inFlight = true;
    this.setStatus("saving");

    try {
      await this.options.send(patch);
      // Only now is it safe to call this sent: a failed request must stay dirty.
      this.tracker.acknowledge(patch);
      this.retryMs = FIRST_RETRY_MS;
      this.inFlight = false;

      if (this.dirty) {
        this.dirty = false;
        this.notify();
      } else {
        this.setStatus("idle");
      }
    } catch (error) {
      this.inFlight = false;
      const kind = this.options.classify?.(error) ?? "retry";
      if (kind !== "retry") {
        // Not acknowledged, so it goes out again with the next change — which is the
        // only thing that can make the answer different. Nothing is armed until then.
        this.retryMs = FIRST_RETRY_MS;
        this.setStatus(kind);
        if (this.dirty) {
          this.dirty = false;
          this.notify();
        }
        return;
      }
      this.setStatus("error");
      // The patch was not acknowledged, so the next diff rebuilds it from scratch —
      // which also picks up whatever the user drew while we were failing.
      this.arm(this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
    }
  }

  private setStatus(status: AutosaveStatus): void {
    this.options.onStatus?.(status);
  }
}
