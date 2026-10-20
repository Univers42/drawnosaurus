import { BROWSER_MODE } from "../mode.ts";
import { browserStore } from "./browser.ts";
import { serverStore } from "./server.ts";
import type { BoardStore } from "./types.ts";

/**
 * The store every board caller goes through: the API in the Docker build, this browser's
 * IndexedDB in the public one. `BROWSER_MODE` is a constant by build time, so the minifier
 * keeps one branch and drops the other store's code with it.
 */
export const boards: BoardStore = BROWSER_MODE
  ? browserStore({ idb: globalThis.indexedDB })
  : serverStore;
