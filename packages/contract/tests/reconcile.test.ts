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
