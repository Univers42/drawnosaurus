/**
 * Element-level last-write-wins reconciliation — the one merge rule in the system.
 *
 * Two tabs, an offline reconnect, and a retried request all produce overlapping
 * writes for the same board. Rather than locking, each element carries a stamp and
 * the newer stamp wins per id, so the outcome does not depend on arrival order.
 *
 * The stamp fields come from the engine itself (`engine/src/types.ts`): `version`
 * counts edits, `versionNonce` is re-randomised on every edit, `updated` is a
 * clock. Comparing in that order means the decision never rests on clock skew
 * unless the edit counts genuinely tie.
 */

export interface VersionStamp {
  version: number;
  versionNonce: number;
  updated: number;
}

export interface Reconcilable extends VersionStamp {
  id: string;
}

/** Negative if `a` is older, positive if newer, 0 only when all three agree. */
export function compareStamps(a: VersionStamp, b: VersionStamp): number {
  if (a.version !== b.version) return a.version - b.version;
  if (a.versionNonce !== b.versionNonce) return a.versionNonce - b.versionNonce;
  return a.updated - b.updated;
}

export function isNewer(candidate: VersionStamp, incumbent: VersionStamp): boolean {
  return compareStamps(candidate, incumbent) > 0;
}

export interface ReconcileResult<T> {
  elements: T[];
  /** Incoming elements that won (new id, or a newer stamp). */
  applied: number;
  /** Incoming elements dropped as stale — a normal outcome, not an error. */
  rejected: number;
}

/**
 * Merge `incoming` into `base`, newest stamp per id winning.
 *
 * Array position is z-order in this engine, so existing elements keep their slot
 * and genuinely new ones append (drawn last renders on top). A client that
 * reordered the stack must say so explicitly — see `applyOrder`, because
 * `reorder_elements` in the engine moves elements without touching their stamps,
 * which makes a reorder invisible to a stamp-based diff.
 */
export function reconcileElements<T extends Reconcilable>(
  base: readonly T[],
  incoming: readonly T[],
): ReconcileResult<T> {
  const merged = new Map<string, T>();
  for (const element of base) merged.set(element.id, element);

  let applied = 0;
  let rejected = 0;

  for (const next of incoming) {
    const current = merged.get(next.id);
    if (current === undefined || isNewer(next, current)) {
      // Map.set on an existing key keeps the original insertion slot, so a
      // stamp update never silently restacks the scene.
      merged.set(next.id, next);
      applied += 1;
    } else {
      rejected += 1;
    }
  }

  return { elements: [...merged.values()], applied, rejected };
}

/**
 * Re-sequence elements to a client-declared id order (a z-order change).
 *
 * Ids named in `order` take those positions; anything unnamed keeps its relative
 * order and lands on top. That is the safe bias: an element the reordering client
 * had never seen is by definition newer than the stack it is being merged into.
 * Unknown ids in `order` are ignored, so a stale order cannot resurrect a deleted
 * element.
 */
export function applyOrder<T extends { id: string }>(
  elements: readonly T[],
  order: readonly string[],
): T[] {
  const rank = new Map<string, number>();
  order.forEach((id, index) => {
    if (!rank.has(id)) rank.set(id, index);
  });

  const ranked: T[] = [];
  const unranked: T[] = [];
  for (const element of elements) {
    if (rank.has(element.id)) ranked.push(element);
    else unranked.push(element);
  }

  ranked.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  return [...ranked, ...unranked];
}

/** Live (non-tombstoned) elements, in z-order. */
export function liveElements<T extends { isDeleted: boolean }>(elements: readonly T[]): T[] {
  return elements.filter((element) => !element.isDeleted);
}
