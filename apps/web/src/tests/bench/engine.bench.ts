import { bench, describe } from "vitest";
import { SceneDiffTracker } from "../../lib/autosave/sceneDiff.ts";
import { migrateLegacyStickyGroups } from "../../lib/notes/stickyNotes.ts";
import type { DrawElementDto } from "@drawnosaurus/contract";

describe("Drawnosaurus Benchmark Suite", () => {
  const baseScene: DrawElementDto[] = Array.from({ length: 500 }, (_, i) => ({
    id: `el_${i}`,
    type: "rectangle",
    x: i * 10,
    y: i * 10,
    width: 100,
    height: 100,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    roundness: null,
    seed: i,
    version: 1,
    versionNonce: 1234,
    updated: 1000,
    isDeleted: false,
  }));

  const nextScene: DrawElementDto[] = baseScene.map((el, i) =>
    i % 10 === 0 ? { ...el, version: el.version + 1, versionNonce: 5678, updated: 2000 } : el,
  );

  const tracker = new SceneDiffTracker<DrawElementDto>();
  tracker.reset(baseScene);

  bench("Autosave: compute diff across 500 dense elements", () => {
    tracker.diff(nextScene, 3000, () => 1);
  });

  // What every board load pays: looking for a legacy sticky note on a board without one.
  bench("Sticky Notes: find no legacy note among 500 elements", () => {
    migrateLegacyStickyGroups(baseScene, 3000, () => 1);
  });
});
