/**
 * Turns "the scene changed" into the smallest patch that still converges.
 *
 * Sending the whole scene on every stroke would push megabytes a second on a busy
 * board, so the tracker remembers what the server acknowledged and emits only the
 * difference.
 *
 * Three engine behaviours drive the design:
 *
 *  1. The exported JSON DROPS tombstones (`export_json_drops_tombstones` in
 *     crates/draw-engine/tests/draw_engine.rs), so a deletion arrives here as an id
 *     that simply vanished and the tombstone the server's merge needs has to be
 *     synthesised.
 *  2. Undo can bring a deleted element back with its ORIGINAL stamp, which would
 *     lose to the tombstone we already sent. A resurrection is therefore re-stamped
 *     to outrank it.
 *  3. Z-order is array position, and `reorder_elements` moves elements without
 *     touching stamps, so a reorder is invisible to a stamp diff. We predict the
 *     order the server will arrive at and send an explicit one only on a mismatch.
 */

export interface StampedElement {
  id: string;
  version: number;
  versionNonce: number;
  updated: number;
  isDeleted: boolean;
}

export interface ScenePatch<T extends StampedElement> {
  elements: T[];
  /** Only set when the predicted server order disagrees with the live one. */
  order?: string[];
}

const sameSequence = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, index) => id === b[index]);

/**
 * The live id order the server will hold after applying `patch` with no explicit
 * order: survivors keep their sequence, new ids append.
 *
 * Both the prediction in `diff` and the bookkeeping in `acknowledge` go through
 * here, so the two cannot disagree about what the server ended up with.
 */
function predictOrder<T extends StampedElement>(
  order: readonly string[],
  patch: readonly T[],
): string[] {
  const removed = new Set(patch.filter((element) => element.isDeleted).map((e) => e.id));
  const kept = removed.size > 0 ? order.filter((id) => !removed.has(id)) : [...order];
  // A set, not `order.includes` per element: that was the board's length times the
  // patch's — 13 million comparisons to drop a stack of 1,500 shapes on a board of 9,000,
  // a 60ms stall at the end of the drag.
  const present = new Set(order);
  const appended = patch
    .filter((element) => !element.isDeleted && !present.has(element.id))
    .map((element) => element.id);

  return [...kept, ...appended];
}

/** The tombstone that tells the server an element it has was deleted. */
function tombstoneOf<T extends StampedElement>(previous: T, now: number, nonce: () => number): T {
  const tombstone: T = {
    ...previous,
    isDeleted: true,
    version: previous.version + 1,
    versionNonce: nonce(),
    updated: now,
  };
  // Nothing draws a tombstone, and an image's picture is most of its size: sent with it,
  // every deleted photo went on counting against the board's 16MB, and deleting images
  // never made room. Undo does not need it — the engine keeps its own copy and sends the
  // whole element back.
  delete (tombstone as { dataUrl?: unknown }).dataUrl;
  return tombstone;
}

export class SceneDiffTracker<T extends StampedElement> {
  /** Last acknowledged element per id, tombstones included. */
  private known = new Map<string, T>();
  /** Last acknowledged LIVE id sequence — the server's z-order as we understand it. */
  private order: string[] = [];
  /**
   * The ids changed since the last acknowledged diff, each with the note it came in, or
   * `null` when something happened that only comparing everything can see.
   *
   * The engine says what changed; the tracker used to ignore that and compare every
   * element on the board against what the server has, on every save and every live
   * send. On 9,000 shapes that was a millisecond and a half per Ctrl+D, twice. With the
   * ids it looks at those and nothing else. A whole scene arriving — an undo, a reorder,
   * a file opened — can change anything, and puts it back to comparing everything.
   */
  private touched: Map<string, number> | null = new Map();
  /** Counts notes, so an acknowledgement can tell which ones its diff covered. */
  private notes = 0;
  /** The patch last returned by `diff`, and the note it was built at. */
  private lastDiff: { patch: ScenePatch<T>; at: number; full: boolean } | null = null;

  /** Adopt the server's truth: initial load, or a reload after a conflict. */
  reset(elements: readonly T[]): void {
    this.known = new Map(elements.map((element) => [element.id, element]));
    this.order = elements.filter((element) => !element.isDeleted).map((element) => element.id);
    this.touched = new Map();
    this.lastDiff = null;
  }

  /**
   * These ids changed — in place, or new on top, or deleted. Only what a delta from the
   * engine can say: nothing moved in the stack.
   */
  noteChanged(ids: Iterable<string>): void {
    this.notes += 1;
    if (this.touched === null) return;
    // A map keeps the place of an id's first note, so it is walked in the order ids were
    // first seen — which, for new elements, is the order they went on top.
    for (const id of ids) this.touched.set(id, this.notes);
  }

  /** Something changed that only a full comparison can find. */
  noteEverything(): void {
    this.notes += 1;
    this.touched = null;
  }

  /**
   * The patch that brings the server to `current`, or null when already in sync.
   *
   * `now` and `nonce` are injected rather than read from the ambient clock so a
   * synthesised stamp is reproducible in a test.
   */
  diff(
    current: readonly T[],
    now: number,
    nonce: () => number,
    lookup?: (id: string) => T | undefined,
  ): ScenePatch<T> | null {
    const patch =
      this.touched !== null && lookup
        ? this.diffTouched(this.touched, lookup, now, nonce)
        : this.diffAll(current, now, nonce);
    this.lastDiff = patch ? { patch, at: this.notes, full: this.touched === null } : null;
    if (!patch) this.settle(this.notes, this.touched === null);
    return patch;
  }

  /** What `diff` does when told which ids changed: those, and nothing else. */
  private diffTouched(
    touched: ReadonlyMap<string, number>,
    lookup: (id: string) => T | undefined,
    now: number,
    nonce: () => number,
  ): ScenePatch<T> | null {
    const changed: T[] = [];
    for (const id of touched.keys()) {
      const element = lookup(id);
      if (element && !element.isDeleted) {
        const next = this.changeOf(element, now, nonce);
        if (next) changed.push(next);
        continue;
      }
      const previous = this.known.get(id);
      if (previous && !previous.isDeleted) changed.push(tombstoneOf(previous, now, nonce));
    }
    // Nothing moved in the stack — the engine sends a delta only when nothing did — and
    // new elements went on top in the order they were noted, which is the order the
    // server will append them in. So the prediction is the order, and none is sent.
    return changed.length === 0 ? null : { elements: changed };
  }

  /** How `element` differs from what the server has, as the element to send — or null. */
  private changeOf(element: T, now: number, nonce: () => number): T | null {
    const previous = this.known.get(element.id);
    if (previous === undefined) return element;
    // A resurrection — undo of a delete — that does not outrank the tombstone we sent
    // would lose to it and stay deleted server-side, so it is re-stamped here. Only
    // then: the engine now stamps an undo above whatever it restores over, and a host
    // stamp minted on top of that would never reach the engine, so its next edit of
    // the element would carry a lower version than the server's and be refused. The
    // branch stays for boards restored from an older engine or a local draft.
    if (previous.isDeleted && element.version <= previous.version) {
      return {
        ...element,
        version: Math.max(element.version, previous.version) + 1,
        versionNonce: nonce(),
        updated: now,
      };
    }
    if (previous.version !== element.version || previous.versionNonce !== element.versionNonce) {
      return element;
    }
    return null;
  }

  /** Comparing everything: the scene as it is against everything the server has. */
  private diffAll(current: readonly T[], now: number, nonce: () => number): ScenePatch<T> | null {
    const live = current.filter((element) => !element.isDeleted);
    const changed: T[] = [];

    for (const element of live) {
      const next = this.changeOf(element, now, nonce);
      if (next) changed.push(next);
    }

    const present = new Set(live.map((element) => element.id));
    for (const [id, previous] of this.known) {
      if (present.has(id) || previous.isDeleted) continue;
      changed.push(tombstoneOf(previous, now, nonce));
    }

    const predicted = predictOrder(this.order, changed);
    const actual = live.map((element) => element.id);
    const reordered = !sameSequence(predicted, actual);

    if (changed.length === 0 && !reordered) return null;

    return reordered ? { elements: changed, order: actual } : { elements: changed };
  }

  /**
   * Record a patch the server accepted. Only what was actually sent becomes known,
   * so an element that missed the request stays dirty and goes out next time.
   */
  acknowledge(patch: ScenePatch<T>): void {
    const nextOrder = patch.order ?? predictOrder(this.order, patch.elements);
    for (const element of patch.elements) this.known.set(element.id, element);
    this.order = nextOrder;
    // What the last diff looked at is now settled — unless it has been noted again since.
    // A patch that did not come from a diff (a peer's, adopted) settles nothing.
    if (this.lastDiff?.patch === patch) {
      this.settle(this.lastDiff.at, this.lastDiff.full);
      this.lastDiff = null;
    }
  }

  /** Forgets the notes up to `at`, which a diff covered and the server now has. */
  private settle(at: number, full: boolean): void {
    if (this.touched === null) {
      // Back to notes only if nothing needing a full comparison came in since.
      if (full && at === this.notes) this.touched = new Map();
      return;
    }
    for (const [id, note] of this.touched) if (note <= at) this.touched.delete(id);
  }

  /** Visible for diagnostics: the z-order we believe the server holds. */
  get serverOrder(): readonly string[] {
    return this.order;
  }

  /** Visible for diagnostics: how many ids we believe the server holds. */
  get knownCount(): number {
    return this.known.size;
  }

  /** Every element the other side is known to have, tombstones included. */
  knownElements(): IterableIterator<T> {
    return this.known.values();
  }
}
