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
/** An embed's address. Long enough for any real link, signed ones included. */
export const MAX_URL_LENGTH = 4096;

/** List endpoints paginate; this is the ceiling a caller can ask for. */
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 24;

/**
 * How deeply groups may nest.
 *
 * Nesting is unbounded in principle — a group can contain a group indefinitely — but a
 * wire format has to bound it, or a crafted document can carry an arbitrarily long array
 * per element. Thirty-two is far past any drawing anyone makes by hand and still cheap to
 * validate.
 */
export const MAX_GROUP_DEPTH = 32;

/**
 * The longest image a single element may carry, as its `data:` URL.
 *
 * The web app refuses files over 4MB after shrinking them to 1440px, and base64 costs a
 * third on top: 4MB of bytes is about 5.6MB of URL. Six leaves headroom for the header
 * and stays under the 8MB request body limit, so one image always fits in one autosave.
 *
 * It does **not** make a board of many images fit: a board is one MongoDB document and
 * the images live inline in it, so the 16MB document ceiling is reached at two or three
 * large pictures. The fix for that is a file store keyed by id, as Excalidraw has; see
 * `docs/reference/images.md`.
 */
export const MAX_IMAGE_DATA_URL_LENGTH = 6 * 1024 * 1024;
