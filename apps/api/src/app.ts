import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { assertAuthModeSupported } from "./auth.ts";
import { registerBoardRoutes } from "./boards/routes.ts";
import { registerLiveRoutes } from "./boards/live.ts";
import { BoardRepository } from "./boards/repository.ts";
import type { Config } from "./config.ts";
import { registerErrorHandler } from "./errors.ts";
import type { MongoHandle } from "./mongo.ts";

export interface BuildAppOptions {
  config: Config;
  mongo: MongoHandle;
  logger?: boolean;
}

/**
 * Builds the app from an already-connected Mongo handle. Taking the connection as
 * an argument is what lets the integration tests drive the real routes against a
 * real database without a server socket or a process to tear down.
 */
export async function buildApp({
  config,
  mongo,
  logger = true,
}: BuildAppOptions): Promise<FastifyInstance> {
  assertAuthModeSupported(config);

  const app = Fastify({
    logger,
    // The ceiling on an incoming scene. Fastify rejects past this with a 413
    // before any handler or zod schema runs.
    bodyLimit: config.bodyLimit,
  });

  // `methods` is explicit because @fastify/cors defaults to GET,HEAD,POST — which
  // silently fails the preflight for every mutating route this API has. The browser
  // then blocks the request before it is sent, so the server logs nothing and only
  // the cross-origin deployment (compose publishes web and api on different ports)
  // is affected; the same-origin dev proxy never preflights at all.
  await app.register(cors, {
    origin: config.corsOrigin,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
    exposedHeaders: ["ETag", "Location"],
  });
  await app.register(websocket);

  registerErrorHandler(app);

  // Liveness answers "is the process up", readiness "can it serve traffic" — an
  // orchestrator needs to tell a booting instance from a broken one.
  app.get("/healthz", async () => ({ status: "ok" }));

  app.get("/readyz", async (_request, reply) => {
    try {
      await mongo.db.command({ ping: 1 });
      return { status: "ready" };
    } catch {
      return await reply
        .status(503)
        .send({ error: { code: "not_ready", message: "database unreachable" } });
    }
  });

  registerBoardRoutes(app, { repo: new BoardRepository(mongo.boards), config });
  registerLiveRoutes(app);

  return app;
}
