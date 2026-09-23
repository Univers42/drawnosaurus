import { describe, expect, it } from "vitest";
import {
  claimSelection,
  outranks,
  previewInterval,
  resolvePeers,
  type PeerState,
} from "./peerClaims.ts";

type El = { id: string; x: number };

const peer = (clientId: string, claims: Record<string, number>, preview?: El[]): PeerState<El> => {
  const state: PeerState<El> = { clientId, name: `${clientId}'s name`, color: "#e03131", claims };
  if (preview) state.preview = preview;
  return state;
};

describe("outranks", () => {
  it("gives a race to the earlier claim, and a tie to the smaller id", () => {
    expect(outranks({ clientId: "b", at: 1 }, { clientId: "a", at: 2 })).toBe(true);
    expect(outranks({ clientId: "a", at: 2 }, { clientId: "b", at: 1 })).toBe(false);
    expect(outranks({ clientId: "a", at: 1 }, { clientId: "b", at: 1 })).toBe(true);
    expect(outranks({ clientId: "b", at: 1 }, { clientId: "a", at: 1 })).toBe(false);
  });
});

describe("resolvePeers", () => {
  it("hands the engine what each peer holds, with their name and colour", () => {
    const resolved = resolvePeers({ clientId: "me", claims: {} }, [peer("ana", { A: 5 })]);
    expect(resolved).toEqual([
      { id: "ana", name: "ana's name", color: "#e03131", holds: ["A"], preview: [] },
    ]);
  });

  it("gives a shape two people took at once to the same one on both sides", () => {
    // What each of the two computes, from where it stands.
    const ana = peer("ana", { A: 100 });
    const ben = peer("ben", { A: 105 });
    const fromBen = resolvePeers({ clientId: "ben", claims: ben.claims }, [ana]);
    const fromAna = resolvePeers({ clientId: "ana", claims: ana.claims }, [ben]);
    expect(fromBen[0]!.holds, "ben sees ana has it").toEqual(["A"]);
    expect(fromAna[0]!.holds, "ana sees ben does not").toEqual([]);
  });

  it("takes nothing from this client that it took first", () => {
    const resolved = resolvePeers({ clientId: "me", claims: { A: 1 } }, [
      peer("ana", { A: 2, B: 2 }),
    ]);
    expect(resolved[0]!.holds).toEqual(["B"]);
  });

  it("settles a race between two peers the way they settle it themselves", () => {
    const resolved = resolvePeers({ clientId: "me", claims: {} }, [
      peer("ben", { A: 7 }),
      peer("ana", { A: 7 }),
    ]);
    expect(resolved.map((p) => p.holds)).toEqual([[], ["A"]]);
  });

  it("does not show the loser's copy moving under the winner's hands", () => {
    const resolved = resolvePeers({ clientId: "me", claims: { A: 1 } }, [
      peer("ana", { A: 2 }, [
        { id: "A", x: 300 },
        { id: "new", x: 10 },
      ]),
    ]);
    expect(resolved[0]!.preview.map((element) => element.id)).toEqual(["new"]);
  });
});

describe("claimSelection", () => {
  it("keeps the time each shape was taken and stamps only what is new", () => {
    expect(claimSelection({ A: 1, B: 2 }, ["A", "C"], 9)).toEqual({ A: 1, C: 9 });
    expect(claimSelection({ A: 1 }, [], 9)).toEqual({});
  });
});

describe("previewInterval", () => {
  it("sends a small gesture often and a large one less often", () => {
    expect(previewInterval(400)).toBe(50);
    expect(previewInterval(40_000)).toBeGreaterThan(previewInterval(400));
    expect(previewInterval(1_000_000)).toBeGreaterThan(previewInterval(40_000));
  });
});
