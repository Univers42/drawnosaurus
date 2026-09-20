import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";

/**
 * One error envelope for every failure: `{ error: { code, message } }`.
 *
 * Handlers throw; this is the only place that decides a status code or writes a
 * body, so no route can leak a stack trace, a Mongo message, or a file path.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message: string, code = "bad_request"): ApiError =>
  new ApiError(400, code, message);

export const notFound = (message = "board not found"): ApiError =>
  new ApiError(404, "not_found", message);

export const conflict = (message: string): ApiError => new ApiError(409, "conflict", message);

export const preconditionRequired = (message: string): ApiError =>
  new ApiError(428, "precondition_required", message);

/** Zod's issue list, flattened into one actionable line. */
function describeZodError(error: ZodError): string {
  const [first] = error.issues;
  if (first === undefined) return "invalid request body";
  const path = first.path.join(".");
  const where = path === "" ? "body" : path;
  const extra = error.issues.length > 1 ? ` (+${error.issues.length - 1} more)` : "";
  return `${where}: ${first.message}${extra}`;
}

/** Fastify types the handler's error as unknown, so read it defensively. */
function prop(error: unknown, key: string): unknown {
  if (typeof error !== "object" || error === null || !(key in error)) return undefined;
  return (error as Record<string, unknown>)[key];
}

function numberProp(error: unknown, key: string): number | undefined {
  const value = prop(error, key);
  return typeof value === "number" ? value : undefined;
}

function stringProp(error: unknown, key: string): string | undefined {
  const value = prop(error, key);
  return typeof value === "string" ? value : undefined;
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      void reply.status(error.status).send({ error: { code: error.code, message: error.message } });
      return;
    }

    if (error instanceof ZodError) {
      void reply
        .status(400)
        .send({ error: { code: "validation_failed", message: describeZodError(error) } });
      return;
    }

    // Fastify's own errors (body too large, malformed JSON) carry a statusCode and
    // are safe to relay; anything 5xx is ours and gets redacted below.
    const status = numberProp(error, "statusCode") ?? 500;
    if (status < 500) {
      void reply.status(status).send({
        error: {
          code: stringProp(error, "code") ?? "bad_request",
          message: error instanceof Error ? error.message : "bad request",
        },
      });
      return;
    }

    request.log.error({ err: error }, "unhandled error");
    void reply.status(500).send({ error: { code: "internal", message: "internal server error" } });
  });

  app.setNotFoundHandler((_request, reply) => {
    void reply.status(404).send({ error: { code: "not_found", message: "no such route" } });
  });
}
