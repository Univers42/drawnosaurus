import { describe, expect, it } from "vitest";
import { syncPeerLasers, type LaserCursor } from "./peerLaser.ts";

function cursor(over: Partial<LaserCursor> & { clientId: string }): LaserCursor {
  return { color: "#e03131", x: 0, y: 0, pointed: true, ...over };
}

describe("syncPeerLasers", () => {
  it("does nothing for an ordinary cursor", () => {
    const calls: unknown[] = [];
    syncPeerLasers([], [cursor({ clientId: "a", tool: "pointer", down: true })], (...args) =>
      calls.push(args),
    );
    expect(calls).toEqual([]);
  });

  it("an old peer's frame — no tool field at all — never starts a trail", () => {
    const calls: unknown[] = [];
    // Same shape a pre-upgrade peer's cursor message decodes to: `tool` and `down` absent.
    const old = cursor({ clientId: "a" });
    delete old.tool;
    delete old.down;
    syncPeerLasers([], [old], (...args) => calls.push(args));
    expect(calls).toEqual([]);
  });

  it("down, then points while down, then up: start, extend, end", () => {
    const calls: [string, string, number, number, boolean][] = [];
    const emit = (id: string, color: string, x: number, y: number, down: boolean): void => {
      calls.push([id, color, x, y, down]);
    };

    let previous: LaserCursor[] = [];
    const down = cursor({ clientId: "a", tool: "laser", down: true, x: 10, y: 10 });
    syncPeerLasers(previous, [down], emit);
    previous = [down];

    const moved = cursor({ clientId: "a", tool: "laser", down: true, x: 20, y: 15 });
    syncPeerLasers(previous, [moved], emit);
    previous = [moved];

    const up = cursor({ clientId: "a", tool: "laser", down: false, x: 25, y: 18 });
    syncPeerLasers(previous, [up], emit);

    expect(calls).toEqual([
      ["a", "#e03131", 10, 10, true],
      ["a", "#e03131", 20, 15, true],
      ["a", "#e03131", 25, 18, false],
    ]);
  });

  it("a peer gone mid-stroke gets one final down:false at their last position", () => {
    const calls: unknown[] = [];
    const lasering = cursor({ clientId: "a", tool: "laser", down: true, x: 30, y: 40 });
    syncPeerLasers([lasering], [], (...args) => calls.push(args));
    expect(calls).toEqual([["a", "#e03131", 30, 40, false]]);
  });

  it("a peer gone after already releasing gets no redundant end call", () => {
    const calls: unknown[] = [];
    const released = cursor({ clientId: "a", tool: "laser", down: false, x: 30, y: 40 });
    syncPeerLasers([released], [], (...args) => calls.push(args));
    expect(calls).toEqual([]);
  });

  it("skips a peer who has not pointed anywhere yet", () => {
    const calls: unknown[] = [];
    const unpointed = cursor({ clientId: "a", tool: "laser", down: true, pointed: false });
    syncPeerLasers([], [unpointed], (...args) => calls.push(args));
    expect(calls).toEqual([]);
  });

  it("two peers lasering at once are both forwarded, each in their own colour", () => {
    const calls: unknown[] = [];
    const alice = cursor({ clientId: "alice", color: "#e03131", tool: "laser", down: true });
    const bob = cursor({ clientId: "bob", color: "#1971c2", tool: "laser", down: true, x: 5 });
    syncPeerLasers([], [alice, bob], (...args) => calls.push(args));
    expect(calls).toEqual([
      ["alice", "#e03131", 0, 0, true],
      ["bob", "#1971c2", 5, 0, true],
    ]);
  });
});
