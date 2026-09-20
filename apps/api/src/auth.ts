import type { FastifyRequest } from "fastify";
import { ApiError } from "./errors.ts";
import type { Config } from "./config.ts";

const OWNER_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * The one place a request becomes an owner.
 *
 * Every repository query is scoped by the value this returns, so replacing dev
 * mode with real token verification is a change to this function and nothing else.
 *
 * NOT SECURITY YET: in dev mode every caller is the same owner, and the
 * `X-Owner-Id` header lets a caller pick one. That is deliberate and it is why
 * `bearer` mode refuses to start rather than pretending to verify anything.
 */
export function resolveOwner(request: FastifyRequest, config: Config): string {
  if (config.authMode !== "dev") {
    throw new ApiError(501, "not_implemented", "authentication backend is not configured");
  }

  const header = request.headers["x-owner-id"];
  const claimed = Array.isArray(header) ? header[0] : header;

  if (claimed === undefined || claimed === "") return config.devOwnerId;

  if (!OWNER_ID.test(claimed)) {
    throw new ApiError(400, "bad_owner", "X-Owner-Id must be 1-128 id-safe characters");
  }

  return claimed;
}

/**
 * Startup guard. A deployment that sets AUTH_MODE=bearer expects requests to be
 * authenticated; booting with an unimplemented verifier would silently serve every
 * board to everyone, so it fails loudly instead.
 */
export function assertAuthModeSupported(config: Config): void {
  if (config.authMode === "bearer") {
    throw new Error(
      "AUTH_MODE=bearer is not implemented: resolveOwner() has no token verifier yet. " +
        "Implement it before enabling this mode.",
    );
  }
}
