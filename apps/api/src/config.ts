/**
 * Environment is read once, here, and validated. A missing connection string is a
 * startup failure rather than a 500 on the first request.
 */

export type AuthMode = "dev" | "bearer";

export interface Config {
  mongoUrl: string;
  dbName: string;
  host: string;
  port: number;
  corsOrigin: string;
  /** Ceiling on a request body. The real guard against an oversized scene. */
  bodyLimit: number;
  authMode: AuthMode;
  /** Owner every request maps to while authMode is "dev". */
  devOwnerId: string;
}

const DEFAULT_BODY_LIMIT = 8 * 1024 * 1024;

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value === "") {
    throw new Error(`${key} is required (no default — point it at a MongoDB instance)`);
  }
  return value;
}

function intOr(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`expected a positive integer, got "${value}"`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const authMode: AuthMode = env.AUTH_MODE === "bearer" ? "bearer" : "dev";

  return {
    mongoUrl: required(env, "MONGO_URL"),
    dbName: env.MONGO_DB ?? "drawnosaurus",
    host: env.HOST ?? "0.0.0.0",
    port: intOr(env.PORT, 4000),
    corsOrigin: env.CORS_ORIGIN ?? "*",
    bodyLimit: intOr(env.BODY_LIMIT, DEFAULT_BODY_LIMIT),
    authMode,
    devOwnerId: env.DEV_OWNER_ID ?? "dev-owner",
  };
}
