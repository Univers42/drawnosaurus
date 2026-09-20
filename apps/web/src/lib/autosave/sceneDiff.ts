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
  const kept = order.filter((id) => !removed.has(id));
  const appended = patch
    .filter((element) => !element.isDeleted && !order.includes(element.id))
    .map((element) => element.id);

  return [...kept, ...appended];
}

export class SceneDiffTracker<T extends StampedElement> {
  /** Last acknowledged element per id, tombstones included. */
  private known = new Map<string, T>();
  /** Last acknowledged LIVE id sequence — the server's z-order as we understand it. */
  private order: string[] = [];

  /** Adopt the server's truth: initial load, or a reload after a conflict. */
  reset(elements: readonly T[]): void {
    this.known = new Map(elements.map((element) => [element.id, element]));
    this.order = elements.filter((element) => !element.isDeleted).map((element) => element.id);
  }

  /**
   * The patch that brings the server to `current`, or null when already in sync.
   *
   * `now` and `nonce` are injected rather than read from the ambient clock so a
   * synthesised stamp is reproducible in a test.
   */
  diff(current: readonly T[], now: number, nonce: () => number): ScenePatch<T> | null {
    const live = current.filter((element) => !element.isDeleted);
    const changed: T[] = [];

    for (const element of live) {
      const previous = this.known.get(element.id);

      if (previous === undefined) {
        changed.push(element);
        continue;
      }

      if (previous.isDeleted) {
        changed.push({
          ...element,
          version: Math.max(element.version, previous.version) + 1,
          versionNonce: nonce(),
          updated: now,
        });
        continue;
      }

      if (previous.version !== element.version || previous.versionNonce !== element.versionNonce) {
        changed.push(element);
      }
    }

    const present = new Set(live.map((element) => element.id));
    for (const [id, previous] of this.known) {
      if (present.has(id) || previous.isDeleted) continue;
      changed.push({
        ...previous,
        isDeleted: true,
        version: previous.version + 1,
        versionNonce: nonce(),
        updated: now,
      });
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
  }

  /** Visible for diagnostics: how many ids we believe the server holds. */
  get knownCount(): number {
    return this.known.size;
  }
}
