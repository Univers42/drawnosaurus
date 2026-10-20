import * as api from "../api/client.ts";
import type { BoardStore } from "./types.ts";

/** The Docker build's store: each operation is the matching API call. */
export const serverStore: BoardStore = {
  list: api.listBoards,
  create: api.createBoard,
  get: api.getBoard,
  patchElements: api.patchElements,
  replace: api.replaceBoard,
  remove: api.deleteBoard,
  putThumbnail: api.putThumbnail,
  thumbnail: async (slug, version) => api.thumbnailUrl(slug, version),
};
