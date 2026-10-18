import type { FastifyInstance } from "fastify";
import { MAX_THUMBNAIL_BYTES, isPngBytes, slugSchema } from "@drawnosaurus/contract";
import { resolveOwner } from "../auth.ts";
import type { Config } from "../config.ts";
import { badRequest, notFound } from "../errors.ts";
import type { BoardRepository } from "./repository.ts";
import type { ThumbnailStore } from "./thumbnails.ts";

export interface ThumbnailRoutesDeps {
  repo: BoardRepository;
  config: Config;
  thumbnails: ThumbnailStore;
}

/** Whether an `If-None-Match` header names this ETag (weak validators and lists included). */
function matchesEtag(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  return header.split(",").some((tag) => {
    const value = tag.trim().replace(/^W\//, "");
    return value === "*" || value === etag;
  });
}

/**
 * A board's picture for the gallery. Registered in its own encapsulated plugin so the
 * `image/png` parser exists here and nowhere else: every other route keeps refusing a
 * PNG body with Fastify's 415.
 *
 * The owner scope is the board routes' own (`resolveOwner`, then an owner-scoped
 * `findBySlug`), so a soft-deleted or foreign board is a 404 for both verbs.
 */
export function registerThumbnailRoutes(
  app: FastifyInstance,
  { repo, config, thumbnails }: ThumbnailRoutesDeps,
): void {
  // The app-wide limit is the scene's (8 MiB); a thumbnail gets its own, parser and route.
  app.addContentTypeParser(
    "image/png",
    { parseAs: "buffer", bodyLimit: MAX_THUMBNAIL_BYTES },
    (_request, body, done) => {
      done(null, body);
    },
  );

  app.put(
    "/v1/boards/:slug/thumbnail",
    { bodyLimit: MAX_THUMBNAIL_BYTES },
    async (request, reply) => {
      const owner = resolveOwner(request, config);
      const slug = slugSchema.parse((request.params as { slug: string }).slug);
      const board = await repo.findBySlug(owner, slug);

      const png = request.body as Buffer;
      if (!isPngBytes(png)) {
        throw badRequest("body is not a PNG image", "bad_thumbnail");
      }

      const { etag, updatedAt } = await thumbnails.put(board._id, png);
      await repo.markThumbnail(board._id, updatedAt);

      return await reply.status(204).header("ETag", etag).send();
    },
  );

  app.get("/v1/boards/:slug/thumbnail", async (request, reply) => {
    const owner = resolveOwner(request, config);
    const slug = slugSchema.parse((request.params as { slug: string }).slug);
    const board = await repo.findBySlug(owner, slug);

    const stored = await thumbnails.get(board._id);
    if (stored === null) throw notFound("board has no thumbnail");

    void reply
      .header("ETag", stored.etag)
      .header("Cache-Control", "private, no-cache")
      .header("X-Content-Type-Options", "nosniff");
    if (matchesEtag(request.headers["if-none-match"], stored.etag)) {
      return await reply.status(304).send();
    }
    return await reply.type("image/png").send(stored.png);
  });
}
