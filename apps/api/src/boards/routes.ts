import type { FastifyInstance } from "fastify";
import {
  boardQuerySchema,
  createBoardSchema,
  listQuerySchema,
  patchElementsSchema,
  replaceBoardSchema,
  slugSchema,
} from "@drawnosaurus/contract";
import { resolveOwner } from "../auth.ts";
import type { Config } from "../config.ts";
import { etagFor, parseIfMatch } from "./etag.ts";
import { toBoard, toSummary } from "./presenter.ts";
import type { BoardRepository } from "./repository.ts";

export interface BoardRoutesDeps {
  repo: BoardRepository;
  config: Config;
}

/**
 * The HTTP layer, and only that: resolve the owner, validate the input, call the
 * repository, set the status. Merge rules live in the contract, persistence in the
 * repository, so there is no place here for either to hide.
 */
export function registerBoardRoutes(app: FastifyInstance, { repo, config }: BoardRoutesDeps): void {
  app.get("/v1/boards", async (request) => {
    const owner = resolveOwner(request, config);
    const { limit, cursor } = listQuerySchema.parse(request.query);
    return await repo.list(owner, limit, cursor);
  });

  app.post("/v1/boards", async (request, reply) => {
    const owner = resolveOwner(request, config);
    const { title } = createBoardSchema.parse(request.body);

    const doc = await repo.create(owner, title);

    return await reply
      .status(201)
      .header("ETag", etagFor(doc.rev))
      .header("Location", `/v1/boards/${doc.slug}`)
      .send(toSummary(doc));
  });

  app.get("/v1/boards/:slug", async (request, reply) => {
    const owner = resolveOwner(request, config);
    const slug = slugSchema.parse((request.params as { slug: string }).slug);
    const { include } = boardQuerySchema.parse(request.query);

    const doc = await repo.findBySlug(owner, slug);

    return await reply
      .header("ETag", etagFor(doc.rev))
      .send(toBoard(doc, { tombstones: include === "tombstones" }));
  });

  /**
   * Full replace. `If-Match` is mandatory: without it a stale tab could overwrite a
   * newer scene wholesale, which is precisely what the element-level merge below
   * exists to avoid.
   */
  app.put("/v1/boards/:slug", async (request, reply) => {
    const owner = resolveOwner(request, config);
    const slug = slugSchema.parse((request.params as { slug: string }).slug);
    const expected = parseIfMatch(request.headers["if-match"]);
    const body = replaceBoardSchema.parse(request.body);

    const rev = expected === "*" ? (await repo.findBySlug(owner, slug)).rev : expected;
    const doc = await repo.replace(owner, slug, body.elements, rev, body.title);

    return await reply.header("ETag", etagFor(doc.rev)).send(toBoard(doc));
  });

  /**
   * The autosave path. No precondition by design — concurrent writers reconcile per
   * element instead of racing for the whole document.
   */
  app.patch("/v1/boards/:slug/elements", async (request, reply) => {
    const owner = resolveOwner(request, config);
    const slug = slugSchema.parse((request.params as { slug: string }).slug);
    const body = patchElementsSchema.parse(request.body);

    const { board, applied, rejected } = await repo.patchElements(
      owner,
      slug,
      body.elements,
      body.order,
    );

    return await reply
      .header("ETag", etagFor(board.rev))
      .send({ ...toSummary(board), applied, rejected });
  });

  app.delete("/v1/boards/:slug", async (request, reply) => {
    const owner = resolveOwner(request, config);
    const slug = slugSchema.parse((request.params as { slug: string }).slug);

    await repo.softDelete(owner, slug);

    return await reply.status(204).send();
  });
}
