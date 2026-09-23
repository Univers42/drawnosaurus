/**
 * Which commits this build of the app was made from.
 *
 * A container left running while commits land serves the old code, and nothing on the
 * page says so — it looks exactly like a fix that did not work. That happened three
 * times before this existed: each time a correct change was reported as broken because
 * the stack at :5273 had been built before it.
 *
 * So the image is stamped at build time. `.git` is not in the Docker build context, so
 * the commits cannot be discovered inside it; the Makefile works them out on the host and
 * passes them in as build args, which the Dockerfile exposes to Vite as `VITE_BUILD_*`.
 * `make dev` passes nothing and runs live source, which is what "dev" means here.
 */

export interface BuildStamp {
  /** Short SHA of this repo, with `-dirty` when built from uncommitted changes. */
  app: string;
  /** Short SHA of the engine submodule, likewise. */
  engine: string;
}

const LIVE = "dev";

/** Reads the stamp out of a Vite env object. Pure, so it is testable without Vite. */
export function readBuildStamp(env: Record<string, unknown>): BuildStamp {
  const pick = (value: unknown): string =>
    typeof value === "string" && value.trim() !== "" && value !== "unknown" ? value.trim() : LIVE;
  return { app: pick(env.VITE_BUILD_APP_SHA), engine: pick(env.VITE_BUILD_ENGINE_SHA) };
}

/** One line for a person: which app and which engine they are looking at. */
export function describeBuild(stamp: BuildStamp): string {
  if (stamp.app === LIVE && stamp.engine === LIVE) return "live source (make dev)";
  return `app ${stamp.app} · engine ${stamp.engine}`;
}

/** This build's stamp. */
export const BUILD: BuildStamp = readBuildStamp(import.meta.env as Record<string, unknown>);
