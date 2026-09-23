import { describe, expect, it } from "vitest";
import { describeBuild, readBuildStamp } from "./build.ts";

describe("readBuildStamp", () => {
  it("reads both commits from the Vite env", () => {
    expect(
      readBuildStamp({ VITE_BUILD_APP_SHA: "640652c", VITE_BUILD_ENGINE_SHA: "20aa2e5" }),
    ).toEqual({ app: "640652c", engine: "20aa2e5" });
  });

  it("keeps the dirty marker, which is the whole warning", () => {
    expect(readBuildStamp({ VITE_BUILD_APP_SHA: "640652c-dirty" }).app).toBe("640652c-dirty");
  });

  /**
   * `make dev` passes nothing, and a build without the Makefile's args gets the compose
   * default `unknown`. Both mean "not a stamped image", so neither should be shown as if
   * it were a commit.
   */
  it("reads missing, empty and 'unknown' as live source", () => {
    expect(readBuildStamp({})).toEqual({ app: "dev", engine: "dev" });
    expect(readBuildStamp({ VITE_BUILD_APP_SHA: "", VITE_BUILD_ENGINE_SHA: "unknown" })).toEqual({
      app: "dev",
      engine: "dev",
    });
  });
});

describe("describeBuild", () => {
  it("names both commits for a stamped image", () => {
    expect(describeBuild({ app: "640652c", engine: "20aa2e5" })).toBe(
      "app 640652c · engine 20aa2e5",
    );
  });

  it("says live source for the dev server", () => {
    expect(describeBuild({ app: "dev", engine: "dev" })).toBe("live source (make dev)");
  });
});
