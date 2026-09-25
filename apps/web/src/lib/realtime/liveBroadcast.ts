/**
 * Turns engine scene events into live-collaboration patches.
 *
 * Mirrors the autosave {@link SceneDiffTracker}: the engine drops tombstones from
 * exported JSON and reports soft-deletes as `removed` ids on deltas, so the wire
 * needs synthesised tombstones and an explicit `order` when z-order drifted.
 */
import { fillPictures, PictureLedger } from "../autosave/pictures.ts";
import { SceneDiffTracker, type ScenePatch, type StampedElement } from "../autosave/sceneDiff.ts";
import { SceneMirror, type MirrorDelta } from "../autosave/sceneMirror.ts";

/**
 * Each element a client has, by id, with its stamp: `[version, versionNonce]`, and for a
 * live image a third entry, 1 when it has its picture and 0 when it has not.
 *
 * Sent by whoever joins, so everyone already there can send what they lack — and back,
 * so they can do the same. See {@link LiveSceneBroadcaster.missing}.
 */
export type Inventory = Record<string, readonly number[]>;

const isLiveImage = (element: object): boolean => {
  const { type, isDeleted } = element as { type?: string; isDeleted?: boolean };
  return type === "image" && !isDeleted;
};

const hasPicture = (element: object): boolean =>
  (element as { dataUrl?: string }).dataUrl !== undefined;

export interface SceneDeltaEvent {
  type: "osidraw-delta";
  updated: StampedElement[];
  removed: string[];
  /** Every live id, bottom first, when the stack moved as well (`SceneMirror.apply`). */
  order?: string[];
}

function isDelta(value: unknown): value is SceneDeltaEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "osidraw-delta"
  );
}

export class LiveSceneBroadcaster<T extends StampedElement = StampedElement> {
  private readonly tracker = new SceneDiffTracker<T>();
  /**
   * What peers are sent a diff of. Changed in place and told to the tracker by id, so a
   * send compares what changed and not the board — see `sceneMirror.ts`.
   */
  private readonly live = new SceneMirror<T>();
  /**
   * The pictures the room already has, left off what is sent to it — see
   * `autosave/pictures.ts`. Everyone in it loaded the board, or was sent it on joining.
   */
  private readonly pictures = new PictureLedger();

  /** Seed from the board load so the first stroke is a diff, not a full dump. */
  reset(elements: readonly T[]): void {
    this.live.replace(elements);
    this.tracker.reset(elements);
    this.pictures.reset(elements);
  }

  /**
   * Fold an engine scene event into the mirror and return the patch peers need,
   * or null when nothing changed for collaboration purposes.
   */
  ingest(
    json: string,
    now = Date.now(),
    nonce: () => number = () => Math.floor(Math.random() * 0x7fffffff),
  ): ScenePatch<T> | null {
    if (!this.observe(json)) return null;
    return this.takePatch(now, nonce);
  }

  /**
   * Fold an engine scene event into the mirror, without deciding that peers have it.
   *
   * Separate from {@link takePatch} for the time the socket is down. `ingest` marked each
   * change as shared the moment it was diffed, while the send that followed was dropped
   * for want of a connection — so everything drawn offline was never sent at all. Now a
   * change is only taken when it can go, and what piles up offline goes out as one
   * patch on reconnect. Returns false for a payload that is not a scene event.
   */
  observe(json: string): boolean {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return false;
    }
    if (isDelta(parsed)) {
      this.live.apply(parsed as unknown as MirrorDelta<T>);
      this.tracker.noteChanged(parsed.updated.map((element) => element.id));
      this.tracker.noteChanged(parsed.removed);
      // The stack moved as well: only comparing everything finds the order to send.
      if (parsed.order) this.tracker.noteEverything();
      return true;
    }
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray((parsed as { elements?: unknown }).elements)
    ) {
      this.live.replace((parsed as { elements: T[] }).elements);
      this.tracker.noteEverything();
      return true;
    }
    return false;
  }

  /**
   * What peers do not have yet, marked as theirs. Null when they have everything.
   *
   * Without the pictures they already have: moving a photo sent the photo to everyone,
   * every time.
   */
  takePatch(
    now = Date.now(),
    nonce: () => number = () => Math.floor(Math.random() * 0x7fffffff),
  ): ScenePatch<T> | null {
    const patch = this.tracker.diff(this.live.elements, now, nonce, this.live.lookup);
    if (!patch) return null;
    this.tracker.acknowledge(patch);
    const elements = this.pictures.strip(patch.elements);
    this.pictures.note(patch.elements);
    return patch.order ? { elements, order: patch.order } : { elements };
  }

  /**
   * A peer's elements, each image that came without its picture given the one here: its
   * sender left it off because the room had it.
   */
  withPictures(elements: readonly T[]): T[] {
    return fillPictures(elements, this.live.lookup);
  }

  /** What this client has — see {@link Inventory}. Call after sending what is pending. */
  inventory(): Inventory {
    const have: Record<string, number[]> = {};
    for (const element of this.tracker.knownElements()) {
      const stamp = [element.version, element.versionNonce];
      if (isLiveImage(element)) stamp.push(hasPicture(element) ? 1 : 0);
      have[element.id] = stamp;
    }
    return have;
  }

  /**
   * What a peer with `have` lacks: whatever they have not got, or have an older copy
   * of, or have without its picture — whole, pictures included. Deletions only of what
   * they have. Call after sending what is pending, so it is all known here.
   */
  missing(have: Inventory): T[] {
    const lacking: T[] = [];
    for (const element of this.tracker.knownElements()) {
      const theirs = have[element.id];
      if (!theirs) {
        if (!element.isDeleted) lacking.push(element);
        continue;
      }
      const [version = 0, nonce = 0, picture] = theirs;
      const newer =
        element.version > version || (element.version === version && element.versionNonce > nonce);
      const pictureOnly = picture === 0 && isLiveImage(element) && hasPicture(element);
      if (newer || pictureOnly) lacking.push(element);
    }
    return lacking;
  }

  /**
   * Apply a peer's patch to the local mirror without producing an outbound patch —
   * otherwise we would echo their edit straight back.
   */
  adoptRemote(patch: ScenePatch<T>): void {
    this.pictures.note(patch.elements);
    if (patch.order) {
      const byId = new Map(this.live.elements.map((element) => [element.id, element]));
      for (const element of patch.elements) byId.set(element.id, element);
      const ordered: T[] = [];
      for (const id of patch.order) {
        const element = byId.get(id);
        if (element) {
          ordered.push(element);
          byId.delete(id);
        }
      }
      for (const element of byId.values()) ordered.push(element);
      this.live.replace(ordered);
    } else {
      this.live.apply({ updated: patch.elements, removed: [] });
    }
    this.tracker.acknowledge(patch);
  }

  get snapshot(): readonly T[] {
    return this.live.elements;
  }
}

/** Host-facing delta so the page `live` array and autosaver see peer deletes. */
export function remotePatchToSceneEvent<T extends StampedElement>(patch: ScenePatch<T>): string {
  if (patch.order && patch.order.length > 0) {
    const byId = new Map(patch.elements.filter((e) => !e.isDeleted).map((e) => [e.id, e]));
    // Prefer the ordered live elements; fall back to patch contents for unknowns.
    const elements = patch.order
      .map((id) => byId.get(id))
      .filter((element): element is T => element !== undefined);
    for (const element of byId.values()) {
      if (!elements.includes(element)) elements.push(element);
    }
    return JSON.stringify({ type: "osidraw", version: 1, elements });
  }

  return JSON.stringify({
    type: "osidraw-delta",
    updated: patch.elements.filter((element) => !element.isDeleted),
    removed: patch.elements.filter((element) => element.isDeleted).map((element) => element.id),
  });
}
