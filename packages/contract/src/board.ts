import { z } from "zod";
import { worldBoundsSchema } from "./bounds.ts";
import { drawElementSchema } from "./element.ts";
import {
  DEFAULT_PAGE_SIZE,
  MAX_ELEMENTS_PER_BOARD,
  MAX_ID_LENGTH,
  MAX_PAGE_SIZE,
  MAX_TITLE_LENGTH,
  SUPPORTED_OSIDRAW_VERSION,
} from "./limits.ts";

/** Slugs are server-minted and URL-safe; clients never choose one. */
export const slugSchema = z
  .string()
  .regex(/^[a-z0-9]{6,32}$/, "must be 6-32 lowercase alphanumeric characters");

/**
 * The `.osidraw` envelope the engine reads and writes (`engine/src/json.ts`). The
 * API stores it verbatim, so a board round-trips through the engine unchanged.
 */
export const osidrawFileSchema = z.object({
  type: z.literal("osidraw"),
  version: z.number().int().min(1).max(SUPPORTED_OSIDRAW_VERSION),
  elements: z.array(drawElementSchema).max(MAX_ELEMENTS_PER_BOARD),
});

export const createBoardSchema = z.object({
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
});

/** Full replace. Paired with `If-Match` so it cannot silently clobber. */
export const replaceBoardSchema = osidrawFileSchema.extend({
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH).optional(),
});

/**
 * The autosave path: only elements whose stamp moved, plus tombstones.
 *
 * `order` is optional and carries the full id sequence, needed because a z-order
 * change moves elements without changing any stamp — see `applyOrder`.
 */
export const patchElementsSchema = z.object({
  elements: z.array(drawElementSchema).max(MAX_ELEMENTS_PER_BOARD),
  order: z.array(z.string().max(MAX_ID_LENGTH)).max(MAX_ELEMENTS_PER_BOARD).optional(),
});

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  cursor: z.string().max(256).optional(),
});

/** List rows never carry elements — that is the point of the denormalised fields. */
export const boardSummarySchema = z.object({
  slug: slugSchema,
  title: z.string(),
  elementCount: z.number().int().min(0),
  bounds: worldBoundsSchema.nullable(),
  rev: z.number().int().min(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const boardListSchema = z.object({
  boards: z.array(boardSummarySchema),
  /** Absent when there is no further page. */
  nextCursor: z.string().nullable(),
});

export const boardSchema = boardSummarySchema.extend({
  scene: osidrawFileSchema,
});

/** One envelope for every failure, so clients need a single error path. */
export const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export type OsidrawFile = z.infer<typeof osidrawFileSchema>;
export type CreateBoardBody = z.infer<typeof createBoardSchema>;
export type ReplaceBoardBody = z.infer<typeof replaceBoardSchema>;
export type PatchElementsBody = z.infer<typeof patchElementsSchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
export type BoardSummary = z.infer<typeof boardSummarySchema>;
export type BoardList = z.infer<typeof boardListSchema>;
export type Board = z.infer<typeof boardSchema>;
export type ApiError = z.infer<typeof errorSchema>;
