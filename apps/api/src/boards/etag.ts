import { badRequest, preconditionRequired } from "../errors.ts";

/**
 * A board's `rev` doubles as its ETag. Full replace requires the caller to echo the
 * rev it last saw, which turns "last writer silently wins" into an explicit 409.
 */
export function etagFor(rev: number): string {
  return `"${rev}"`;
}

/**
 * Accepts the shapes a real client or proxy may send: `"3"`, `3`, `W/"3"`, or `*`.
 * A missing header is 428 rather than 400 — the request is well-formed, it just
 * refuses to state what it is overwriting.
 */
export function parseIfMatch(header: string | undefined): number | "*" {
  const value = header?.trim();

  if (value === undefined || value === "") {
    throw preconditionRequired("If-Match is required: send the ETag from your last GET, or *");
  }

  if (value === "*") return "*";

  const match = /^(?:W\/)?"?(\d+)"?$/.exec(value);
  if (match?.[1] === undefined) {
    throw badRequest("If-Match must be an ETag from a prior GET", "bad_if_match");
  }

  return Number.parseInt(match[1], 10);
}
