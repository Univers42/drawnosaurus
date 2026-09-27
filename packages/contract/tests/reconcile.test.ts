import { describe, expect, it } from "vitest";
import {
  applyOrder,
  compareStamps,
  isNewer,
  liveElements,
  reconcileElements,
} from "../src/reconcile.ts";
import { element } from "./factory.ts";

const stamps = (elements: readonly { id: string; version: number }[]): string =>
  elements.map((e) => `${e.id}@${e.version}`).join(",");

/** The id pool a drawn stack and a drawn order are cut from. */
const IDS = ["a", "b", "c", "d", "e", "f"];

/**
 * xorshift32, the 32-bit sibling of the xorshift64 the engine's own property tests run
 * on (`ci_text_wrap_props.rs:107-113`), and a closure rather than a class so a case is one
 * line. `seed | 0 || 1` because xorshift is stuck at zero, and a zero seed would make
 * every case the same case.
 */
const rng = (seed: number) => {
  let state = seed | 0 || 1;
  return (n: number): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % n;
  };
};

describe("compareStamps", () => {
  it("orders by version first", () => {
    const older = { version: 1, versionNonce: 9999, updated: 9999 };
    const newer = { version: 2, versionNonce: 0, updated: 0 };
    expect(isNewer(newer, older)).toBe(true);
    expect(isNewer(older, newer)).toBe(false);
  });

  it("breaks a version tie on versionNonce, not the clock", () => {
    const a = { version: 3, versionNonce: 10, updated: 5000 };
    const b = { version: 3, versionNonce: 20, updated: 1 };
    expect(isNewer(b, a)).toBe(true);
  });

  it("falls back to updated only when version and nonce both tie", () => {
    const a = { version: 3, versionNonce: 7, updated: 100 };
    const b = { version: 3, versionNonce: 7, updated: 200 };
    expect(isNewer(b, a)).toBe(true);
    expect(compareStamps(a, a)).toBe(0);
  });
});

describe("reconcileElements", () => {
  it("keeps the newer stamp per id and counts the stale ones", () => {
    const base = [element({ id: "a", version: 2, x: 0 })];
    const incoming = [
      element({ id: "a", version: 1, x: 999 }), // stale
      element({ id: "b", version: 1 }), // new
    ];

    const result = reconcileElements(base, incoming);

    expect(result.applied).toBe(1);
    expect(result.rejected).toBe(1);
    expect(result.elements.find((e) => e.id === "a")?.x).toBe(0);
  });

  it("is idempotent — replaying the same write changes nothing", () => {
    const base = [element({ id: "a", version: 1 }), element({ id: "b", version: 2 })];
    const incoming = [element({ id: "b", version: 3 })];

    const once = reconcileElements(base, incoming);
    const twice = reconcileElements(once.elements, incoming);

    expect(stamps(twice.elements)).toBe(stamps(once.elements));
    expect(twice.applied).toBe(0);
    expect(twice.rejected).toBe(1);
  });

  it("converges on the same stamps regardless of arrival order", () => {
    const base = [element({ id: "a", version: 1 })];
    const first = [element({ id: "a", version: 2 }), element({ id: "b", version: 1 })];
    const second = [element({ id: "a", version: 3 }), element({ id: "c", version: 1 })];

    const forward = reconcileElements(reconcileElements(base, first).elements, second).elements;
    const backward = reconcileElements(reconcileElements(base, second).elements, first).elements;

    const byId = (elements: typeof forward) =>
      [...elements].sort((x, y) => x.id.localeCompare(y.id)).map((e) => `${e.id}@${e.version}`);

    expect(byId(backward)).toEqual(byId(forward));
    expect(byId(forward)).toEqual(["a@3", "b@1", "c@1"]);
  });

  it("does not restack the scene when an existing element is updated", () => {
    const base = [
      element({ id: "a", version: 1 }),
      element({ id: "b", version: 1 }),
      element({ id: "c", version: 1 }),
    ];
    // z-order is array position, so an edit to "a" must not move it to the top.
    const result = reconcileElements(base, [element({ id: "a", version: 2 })]);

    expect(result.elements.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("appends genuinely new elements on top", () => {
    const base = [element({ id: "a" })];
    const result = reconcileElements(base, [element({ id: "z" })]);
    expect(result.elements.map((e) => e.id)).toEqual(["a", "z"]);
  });
});

describe("applyOrder", () => {
  it("re-sequences to the declared id order", () => {
    const elements = [element({ id: "a" }), element({ id: "b" }), element({ id: "c" })];
    expect(applyOrder(elements, ["c", "a", "b"]).map((e) => e.id)).toEqual(["c", "a", "b"]);
  });

  it("puts ids the client never saw on top, in their existing order", () => {
    const elements = [
      element({ id: "a" }),
      element({ id: "new1" }),
      element({ id: "b" }),
      element({ id: "new2" }),
    ];
    expect(applyOrder(elements, ["b", "a"]).map((e) => e.id)).toEqual(["b", "a", "new1", "new2"]);
  });

  it("ignores unknown ids so a stale order cannot resurrect anything", () => {
    const elements = [element({ id: "a" })];
    expect(applyOrder(elements, ["deleted", "a"]).map((e) => e.id)).toEqual(["a"]);
  });

  it("takes an id's first position when the order names it twice", () => {
    // The guard on `reconcile.ts:92`, pinned by what it decides: a repeated id keeps the
    // slot it was given first, as the oracle's fractional index does. No other case here
    // carries a repeated id, so without this one the guard could be deleted and the rest
    // of this file would still pass — measured, not assumed.
    const elements = [element({ id: "a" }), element({ id: "b" }), element({ id: "c" })];
    expect(applyOrder(elements, ["c", "a", "b", "a"]).map((e) => e.id)).toEqual(["c", "a", "b"]);
  });

  it("is idempotent — the same order applied again leaves the stack where it is", () => {
    // A client sends its order on every autosave, so applyOrder is applied to a stack it
    // has already applied it to, over and over, and each pass must land in the same
    // place. Measured, not assumed: this survives the guard at `reconcile.ts:92` being
    // deleted — a sort by a key read off the order is idempotent whatever that key is.
    // What it does not survive is the unnamed bucket built the wrong way round
    // (`unshift` for `push`), which reverses the stack on one pass and back on the next.
    // The cases are drawn to reach both shapes: an order shorter than the stack, one
    // naming an id the stack never had, and one naming the same id twice.
    //
    // Its blind spot is the rank key itself: a command that moved the wrong one is
    // invisible here, in all 200 draws, because a sort is idempotent whatever it sorts on
    // — and 128 of them (86 naming no id of the stack, 42 naming one) would come out the
    // same under any key at all, so only the other 72 could show a wrong key wrong. The
    // named cases above are what a wrong key would have to break.
    for (let seed = 1; seed <= 200; seed += 1) {
      const next = rng(seed);
      // A scene's ids are unique, so the stack is a prefix of a shuffled pool; the order
      // is drawn *with* replacement, which is how the duplicates and the strangers get in.
      // Both indices are in range by construction; the `!` says so rather than the type.
      const pool = [...IDS];
      for (let i = pool.length - 1; i > 0; i -= 1) {
        const j = next(i + 1);
        const held = pool[i]!;
        pool[i] = pool[j]!;
        pool[j] = held;
      }
      const elements = pool.slice(0, next(IDS.length + 1)).map((id) => element({ id }));
      const order = Array.from({ length: next(IDS.length + 1) }, () => IDS[next(IDS.length)]!);

      const once = applyOrder(elements, order);
      const twice = applyOrder(once, order);

      expect(
        twice.map((e) => e.id),
        `seed ${seed}: elements [${elements.map((e) => e.id)}] order [${order}]`,
      ).toEqual(once.map((e) => e.id));
    }
  });
});

describe("liveElements", () => {
  it("drops tombstones and keeps order", () => {
    const elements = [
      element({ id: "a" }),
      element({ id: "b", isDeleted: true }),
      element({ id: "c" }),
    ];
    expect(liveElements(elements).map((e) => e.id)).toEqual(["a", "c"]);
  });
});
