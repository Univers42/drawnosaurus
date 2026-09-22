/**
 * Turns engine scene events into live-collaboration patches.
 *
 * Mirrors the autosave {@link SceneDiffTracker}: the engine drops tombstones from
 * exported JSON and reports soft-deletes as `removed` ids on deltas, so the wire
 * needs synthesised tombstones and an explicit `order` when z-order drifted.
 */
import { SceneDiffTracker, type ScenePatch, type StampedElement } from "../autosave/sceneDiff.ts";

export interface SceneDeltaEvent {
  type: "osidraw-delta";
  updated: StampedElement[];
  removed: string[];
}

function isDelta(value: unknown): value is SceneDeltaEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "osidraw-delta"
  );
}

function applyDelta<T extends StampedElement>(live: readonly T[], delta: SceneDeltaEvent): T[] {
  const removed: Record<string, true> = {};
  for (const id of delta.removed) removed[id] = true;

  const pending: Record<string, T> = {};
  for (const element of delta.updated) {
    if (!element.isDeleted) pending[element.id] = element as T;
  }

  const next: T[] = [];
  for (const element of live) {
    if (removed[element.id]) continue;
    const replacement = pending[element.id];
    if (replacement) {
      next.push(replacement);
      delete pending[element.id];
    } else {
      next.push(element);
    }
  }
  for (const element of Object.values(pending)) next.push(element);
  return next;
}

export class LiveSceneBroadcaster<T extends StampedElement = StampedElement> {
  private readonly tracker = new SceneDiffTracker<T>();
  private live: T[] = [];

  /** Seed from the board load so the first stroke is a diff, not a full dump. */
  reset(elements: readonly T[]): void {
    this.live = elements.filter((element) => !element.isDeleted) as T[];
    this.tracker.reset(elements);
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return null;
    }

    if (isDelta(parsed)) {
      this.live = applyDelta(this.live, parsed);
    } else if (
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray((parsed as { elements?: unknown }).elements)
    ) {
      this.live = (parsed as { elements: T[] }).elements.filter((element) => !element.isDeleted);
    } else {
      return null;
    }

    const patch = this.tracker.diff(this.live, now, nonce);
    if (patch) this.tracker.acknowledge(patch);
    return patch;
  }

  /**
   * Apply a peer's patch to the local mirror without producing an outbound patch —
   * otherwise we would echo their edit straight back.
   */
  adoptRemote(patch: ScenePatch<T>): void {
    const removed = new Set(patch.elements.filter((element) => element.isDeleted).map((e) => e.id));
    const pending = new Map(
      patch.elements
        .filter((element) => !element.isDeleted)
        .map((element) => [element.id, element]),
    );

    let next = this.live.filter((element) => !removed.has(element.id));
    next = next.map((element) => pending.get(element.id) ?? element);
    for (const element of next) pending.delete(element.id);
    for (const element of pending.values()) next.push(element);

    if (patch.order) {
      const byId = new Map(next.map((element) => [element.id, element]));
      const ordered: T[] = [];
      for (const id of patch.order) {
        const element = byId.get(id);
        if (element) {
          ordered.push(element);
          byId.delete(id);
        }
      }
      for (const element of byId.values()) ordered.push(element);
      next = ordered;
    }

    this.live = next;
    this.tracker.acknowledge(patch);
  }

  get snapshot(): readonly T[] {
    return this.live;
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
