/**
 * Hard ceilings for anything crossing the wire. The engine trusts its own scene;
 * the API does not trust the network, so every unbounded field gets a bound here
 * and nowhere else.
 */

/** Highest `.osidraw` envelope version this service understands. */
export const SUPPORTED_OSIDRAW_VERSION = 1;

/**
 * A board is one MongoDB document with its elements embedded. At roughly 300
 * bytes per element this stays far under the 16MB document cap; the request body
 * limit in the API is the tighter, real guard.
 */
export const MAX_ELEMENTS_PER_BOARD = 20_000;

/** Freehand strokes are the only unbounded point array. */
export const MAX_POINTS_PER_ELEMENT = 10_000;

export const MAX_ID_LENGTH = 128;
export const MAX_TEXT_LENGTH = 10_000;
export const MAX_COLOR_LENGTH = 64;
export const MAX_TITLE_LENGTH = 200;

/** List endpoints paginate; this is the ceiling a caller can ask for. */
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 24;
