import { env } from "$env/dynamic/public";
import type { Board, BoardList, BoardSummary, OsidrawFile } from "@drawnosaurus/contract";
import type { ScenePatch, StampedElement } from "../autosave/sceneDiff.ts";

/**
 * Typed client for the v1 API.
 *
 * Paths are relative by default so dev goes through the Vite proxy and prod
 * through the same origin — no CORS in the common case. PUBLIC_API_URL overrides
 * it, read from the DYNAMIC env so one image can point at different backends
 * without a rebuild.
 */
const baseUrl = (): string => (env.PUBLIC_API_URL ?? "").replace(/\/$/, "");

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }
}

/** A 409 is expected traffic (someone else wrote first), so callers can branch on it. */
export const isConflict = (error: unknown): boolean =>
  error instanceof ApiClientError && error.status === 409;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...init.headers,
    },
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload: unknown = text === "" ? null : JSON.parse(text);

  if (!response.ok) {
    // The API always answers with { error: { code, message } }; fall back in case a
    // proxy or the platform produced the response instead.
    const envelope = payload as { error?: { code?: string; message?: string } } | null;
    throw new ApiClientError(
      response.status,
      envelope?.error?.code ?? "http_error",
      envelope?.error?.message ?? `request failed with ${response.status}`,
    );
  }

  return payload as T;
}

export const listBoards = (limit?: number, cursor?: string): Promise<BoardList> => {
  const query = new URLSearchParams();
  if (limit !== undefined) query.set("limit", String(limit));
  if (cursor !== undefined) query.set("cursor", cursor);
  const suffix = query.size === 0 ? "" : `?${query.toString()}`;
  return request<BoardList>(`/v1/boards${suffix}`);
};

export const createBoard = (title: string): Promise<BoardSummary> =>
  request<BoardSummary>("/v1/boards", { method: "POST", body: JSON.stringify({ title }) });

/** `tombstones` includes deleted elements, for catching up after a lost connection. */
export const getBoard = (slug: string, options: { tombstones?: boolean } = {}): Promise<Board> =>
  request<Board>(`/v1/boards/${slug}${options.tombstones ? "?include=tombstones" : ""}`);

export const deleteBoard = (slug: string): Promise<void> =>
  request<void>(`/v1/boards/${slug}`, { method: "DELETE" });

export interface PatchAck extends BoardSummary {
  applied: number;
  rejected: number;
}

export const patchElements = <T extends StampedElement>(
  slug: string,
  patch: ScenePatch<T>,
): Promise<PatchAck> =>
  request<PatchAck>(`/v1/boards/${slug}/elements`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

/** Full replace. `rev` is the one the client last saw; a mismatch is a 409. */
export const replaceBoard = (slug: string, scene: OsidrawFile, rev: number): Promise<Board> =>
  request<Board>(`/v1/boards/${slug}`, {
    method: "PUT",
    headers: { "if-match": `"${rev}"` },
    body: JSON.stringify(scene),
  });
