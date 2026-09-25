/**
 * The host's copy of the scene: every live element, in stacking order, found by id.
 *
 * The page keeps one for saving and the live link keeps one for peers, and both used to
 * rebuild it from scratch on every change the engine reported — the whole board walked
 * and copied for each Ctrl+D, two milliseconds apiece on 9,000 shapes. A change is now
 * applied where it lands: an element replaced in place, a new one put on top. Only a
 * deletion, a delta that moved the stack, or a whole scene rebuilds it.
 */

interface MirroredElement {
  id: string;
  isDeleted?: boolean;
}

/** What the engine reports for a change that can be described element by element. */
export interface MirrorDelta<T> {
  updated: readonly T[];
  removed: readonly string[];
  /**
   * Every live id, bottom first, when the stack moved as well: elements placed beside
   * another — a shape that joined a frame goes directly below it, a new label above its
   * shape. Absent when nothing moved.
   */
  order?: readonly string[];
}

export class SceneMirror<T extends MirroredElement> {
  private list: T[] = [];
  private index = new Map<string, number>();

  /** Every live element, bottom of the stack first. Changed in place: do not keep it. */
  get elements(): readonly T[] {
    return this.list;
  }

  /** One element by id, or undefined when there is none. */
  readonly lookup = (id: string): T | undefined => {
    const at = this.index.get(id);
    return at === undefined ? undefined : this.list[at];
  };

  /**
   * Takes a whole scene — a load, an undo, a reorder — and returns what it changed: the
   * elements that are new or differ by `same`, and the ids that are gone. `same` is
   * identity by default; a scene parsed afresh needs it to compare stamps instead.
   */
  replace(
    elements: readonly T[],
    same: (before: T, after: T) => boolean = (before, after) => before === after,
  ): { changed: T[]; removed: string[] } {
    const before = this.index;
    const previous = this.list;
    this.list = elements.filter((element) => !element.isDeleted);
    this.reindex();
    const changed = this.list.filter((element) => {
      const at = before.get(element.id);
      const was = at === undefined ? undefined : previous[at];
      return was === undefined || !same(was, element);
    });
    const removed = previous.map((element) => element.id).filter((id) => !this.index.has(id));
    return { changed, removed };
  }

  /**
   * Applies a delta, and returns the ids it put on top, in order.
   *
   * An element it names is either where it was or new on top — then, when the delta
   * carries an order, the stack is put in it. The engine used to send the whole scene
   * for that, which on 20,000 shapes was 10.7MB for one shape drawn into a frame.
   */
  apply(delta: MirrorDelta<T>): string[] {
    const appended = this.applyElements(delta);
    if (delta.order) this.arrange(delta.order);
    return appended;
  }

  private applyElements(delta: MirrorDelta<T>): string[] {
    const appended: string[] = [];
    const deletes = delta.removed.length > 0 || delta.updated.some((element) => element.isDeleted);
    if (!deletes) {
      for (const element of delta.updated) {
        const at = this.index.get(element.id);
        if (at === undefined) {
          this.index.set(element.id, this.list.length);
          this.list.push(element);
          appended.push(element.id);
        } else {
          this.list[at] = element;
        }
      }
      return appended;
    }

    const gone = new Set(delta.removed);
    const pending = new Map<string, T>();
    for (const element of delta.updated) {
      if (element.isDeleted) gone.add(element.id);
      else pending.set(element.id, element);
    }
    const next: T[] = [];
    for (const element of this.list) {
      if (gone.has(element.id)) continue;
      const replacement = pending.get(element.id);
      if (replacement) {
        next.push(replacement);
        pending.delete(element.id);
      } else {
        next.push(element);
      }
    }
    // Whatever is left is new, and new elements go on top.
    for (const element of pending.values()) {
      next.push(element);
      appended.push(element.id);
    }
    this.list = next;
    this.reindex();
    return appended;
  }

  /** Puts the stack in `order`. What it leaves out stays, on top, as it was. */
  private arrange(order: readonly string[]): void {
    const listed = new Set(order);
    const next: T[] = [];
    for (const id of order) {
      const element = this.lookup(id);
      if (element) next.push(element);
    }
    for (const element of this.list) if (!listed.has(element.id)) next.push(element);
    this.list = next;
    this.reindex();
  }

  private reindex(): void {
    this.index = new Map(this.list.map((element, at) => [element.id, at]));
  }
}
