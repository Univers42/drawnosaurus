import { serverStore } from "./server.ts";
import type { BoardStore } from "./types.ts";

/** The store every board caller goes through. */
export const boards: BoardStore = serverStore;
