import { SceneAutosaver, type AutosaveStatus } from "../autosave/autosaver.ts";
import type { ScenePatch, StampedElement } from "../autosave/sceneDiff.ts";
import { classifyShared } from "../sharing/storedCopy.ts";
import { forgetUnsent, markUnsent } from "../sharing/status.ts";

/**
 * A shared drawing's online copy, as this page saves it.
 *
 * The copy itself is the store's client (`sharing/storedCopy.ts`): it seals, merges and
 * writes. What is here is the policy the spec sets around it.
 *
 * - **Only this page's own edits are written.** A change that arrived from a peer is
 *   theirs; they write it, and writing it here as well would make two people save the
 *   same edit and race each other over the revision.
 * - **At most once every 20 seconds while there are edits.** A throttle, not a debounce:
 *   the first edit arms the timer and the edits after it do not move it, so someone
 *   drawing without a pause is still saved (`autosave/autosaver.ts`).
 * - **When the page is hidden**, what is left goes out at once, and only a body of 64 KB
 *   or less rides a `keepalive` request — a bigger one is dropped rather than risk the
 *   tab's memory, and the status line says the last seconds may be missing.
 *
 * The copy is written before anything connects (`sharing/shareSession.ts`): the first
 * write stores the drawing's write proof, and the drawing's id must not reach the relay
 * before that.
 */

/** How often the copy is written while there are edits: the spec's twenty seconds. */
export const ONLINE_COPY_THROTTLE_MS = 20_000;

/**
 * What the copy needs of the store's client (`sharing/storedCopy.ts`): a save, and the
 * flag that says the page is closing.
 */
export interface OnlineCopyStore<T extends StampedElement> {
  /** Set while the page is closing: a request of 64 KB or less may outlive it. */
  leaving: boolean;
  /** Merges the patch into the copy and writes it. */
  save(patch: ScenePatch<T>): Promise<void>;
}

export interface OnlineCopyOptions<T extends StampedElement> {
  /** The drawing's address: the store's key, and the mark's. */
  slug: string;
  /** The store's client for this drawing's copy. */
  copy: OnlineCopyStore<T>;
  /** The scene as this page has it, pictures included. */
  readScene: () => readonly T[];
  /** One element by id, so the diff looks at what changed and not at the whole board. */
  lookup?: (id: string) => T | undefined;
  /** Where the "may be missing" mark is kept, between tabs. */
  storage?: Storage | null;
  /** The copy's status, for the header's line. */
  onStatus?: (status: AutosaveStatus) => void;
  /** How often the copy is written while there are edits. */
  throttleMs?: number;
}

export class OnlineCopy<T extends StampedElement> {
  private readonly copy: OnlineCopyStore<T>;
  private readonly saver: SceneAutosaver<T>;
  private readonly readScene: () => readonly T[];
  private readonly slug: string;
  private readonly storage: Storage | null;
  /** Whether the last write had something to write: the mark is about that. */
  private wrote = false;

  constructor(options: OnlineCopyOptions<T>) {
    this.copy = options.copy;
    this.readScene = options.readScene;
    this.slug = options.slug;
    this.storage = options.storage ?? null;
    this.saver = new SceneAutosaver<T>({
      readScene: options.readScene,
      lookup: options.lookup,
      throttleMs: options.throttleMs ?? ONLINE_COPY_THROTTLE_MS,
      classify: classifyShared,
      send: async (patch) => {
        this.wrote = true;
        await this.copy.save(patch);
        // The copy has it now: the doubt about the last seconds is over.
        forgetUnsent(this.storage, this.slug);
      },
      onStatus: (next) => options.onStatus?.(next),
    });
  }

  /** What the copy is known to hold, so the same is not sent again. */
  resetKnown(elements: readonly T[]): void {
    this.saver.tracker.reset(elements);
  }

  /**
   * The whole scene, as the drawing's first copy.
   *
   * Written before the drawing's id reaches the relay: the write stores the drawing's
   * write proof, and whoever watched the relay could otherwise claim it first.
   */
  async writeFirstCopy(): Promise<void> {
    const scene = [...this.readScene()];
    await this.copy.save({ elements: scene });
    // The copy holds the scene now, so the saver must not send it again.
    this.resetKnown(scene);
  }

  /** This page changed these elements. */
  noteChanged(ids: Iterable<string>): void {
    this.saver.tracker.noteChanged(ids);
    this.saver.notify();
  }

  /**
   * This page changed something only a full comparison can find — an undo, a reorder.
   *
   * The whole scene goes then, and it holds what peers sent as well: a full comparison
   * cannot tell the two apart, and the copy merges by element anyway, so the newer stamp
   * of each wins and nothing is lost.
   */
  noteEverything(): void {
    this.saver.tracker.noteEverything();
    this.saver.notify();
  }

  /** The pending edits, written at once: a peer joined, and the copy must have them. */
  async saveNow(): Promise<void> {
    await this.saver.flush();
  }

  /** The page is gone: the timer and the retries stop with it. */
  dispose(): void {
    this.saver.dispose();
  }

  /**
   * The page is leaving: what is left goes out, and the copy may yet lack it.
   *
   * A `keepalive` request only carries 64 KB (`sharing/storedCopy.ts`), and a bigger one
   * is dropped rather than risk the tab's memory — so the mark is left, and the next tab
   * says the last seconds may be missing.
   */
  async leave(): Promise<void> {
    this.copy.leaving = true;
    this.wrote = false;
    await this.saver.flush();
    if (this.wrote) markUnsent(this.storage, this.slug);
    else forgetUnsent(this.storage, this.slug);
  }
}
