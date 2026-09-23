/**
 * @drawnosaurus/contract — the wire contract shared by web and api.
 *
 * Everything here is transport-shaped: schemas that validate untrusted JSON, and
 * the pure merge/geometry primitives both sides need. No Fastify, no Mongo, no
 * DOM — so it stays testable on its own and cannot drag infrastructure into a
 * consumer.
 */

export {
  ARROWHEADS,
  DRAW_ELEMENT_TYPES,
  FILL_STYLES,
  STROKE_STYLES,
  drawElementSchema,
  type DrawElementDto,
  type DrawElementType,
} from "./element.ts";

export {
  boardListSchema,
  boardSchema,
  boardSummarySchema,
  createBoardSchema,
  errorSchema,
  listQuerySchema,
  boardQuerySchema,
  osidrawFileSchema,
  patchElementsSchema,
  replaceBoardSchema,
  slugSchema,
  type ApiError,
  type Board,
  type BoardList,
  type BoardSummary,
  type CreateBoardBody,
  type ListQuery,
  type OsidrawFile,
  type PatchElementsBody,
  type ReplaceBoardBody,
} from "./board.ts";

export { elementBounds, sceneBounds, worldBoundsSchema, type WorldBounds } from "./bounds.ts";

export {
  applyOrder,
  compareStamps,
  isNewer,
  liveElements,
  reconcileElements,
  type Reconcilable,
  type ReconcileResult,
  type VersionStamp,
} from "./reconcile.ts";

export {
  DEFAULT_PAGE_SIZE,
  MAX_COLOR_LENGTH,
  MAX_ELEMENTS_PER_BOARD,
  MAX_ID_LENGTH,
  MAX_IMAGE_DATA_URL_LENGTH,
  MAX_PAGE_SIZE,
  MAX_POINTS_PER_ELEMENT,
  MAX_TEXT_LENGTH,
  MAX_TITLE_LENGTH,
  SUPPORTED_OSIDRAW_VERSION,
} from "./limits.ts";

export { isLoopbackHost, isPrivateHost, shareInfoSchema, type ShareInfo } from "./share.ts";
