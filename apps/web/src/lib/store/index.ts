import { BROWSER_MODE } from "../mode.ts";
import { browserStore } from "./browser.ts";
import { serverStore } from "./server.ts";
import type { BoardStore, SecretStore } from "./types.ts";

/**
 * The store every board caller goes through: the API in the Docker build, this browser's
 * IndexedDB in the public one. `BROWSER_MODE` is a constant by build time, so the minifier
 * keeps one branch and drops the other store's code with it.
 */
const store: (BoardStore & SecretStore) | null = BROWSER_MODE
  ? browserStore({ idb: globalThis.indexedDB })
  : null;

export const boards: BoardStore = store ?? serverStore;

/**
 * Where a shared drawing's secret is kept in this browser: on the drawing's own row, in
 * the public build's store. The Docker build has none — its live key is the board's
 * (`realtime/liveRoom.ts`), and its Share dialog is the server's.
 */
export const secrets: SecretStore | null = store;
