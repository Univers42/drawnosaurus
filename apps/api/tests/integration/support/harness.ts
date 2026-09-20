import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { DrawElementDto } from "@drawnosaurus/contract";
import { buildApp } from "../../../src/app.ts";
import { loadConfig } from "../../../src/config.ts";
import { connectMongo, ensureIndexes } from "../../../src/mongo.ts";

/**
 * Integration tests run against a REAL mongod, never a mock.
 *
 * The things most worth testing here — the unique index on slug, the rev-guarded
 * write that makes concurrent patches safe, keyset pagination — are all behaviours
 * of the database. A fake would only assert that the mock was called.
 *
 * Each file gets its own database so suites can run in parallel without colliding,
 * and `app.inject()` drives the real routes without binding a socket.
 */
export interface TestApp {
  app: FastifyInstance;
  close: () => Promise<void>;
}

export async function startTestApp(): Promise<TestApp> {
  const url = process.env.MONGO_URL;
  if (url === undefined || url === "") {
    throw new Error(
      "MONGO_URL is required for the integration suite. Run `make test-integration`, " +
        "which starts the compose mongo first.",
    );
  }

  const dbName = `drawnosaurus_test_${randomUUID().slice(0, 8)}`;
  const config = loadConfig({ MONGO_URL: url, MONGO_DB: dbName, AUTH_MODE: "dev" });
  const mongo = await connectMongo(url, dbName);
  await ensureIndexes(mongo.boards);

  const app = await buildApp({ config, mongo, logger: false });

  return {
    app,
    close: async () => {
      await mongo.db.dropDatabase();
      await app.close();
      await mongo.close();
    },
  };
}

/** A valid element; tests override only the field under test. */
export function element(patch: Partial<DrawElementDto> = {}): DrawElementDto {
  return {
    id: "el-1",
    type: "rectangle",
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "hachure",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 100,
    updated: 1,
    isDeleted: false,
    ...patch,
  };
}

/** Create a board and return its slug. */
export async function createBoard(app: FastifyInstance, title = "Test board"): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/v1/boards", payload: { title } });
  if (response.statusCode !== 201) {
    throw new Error(`could not create a board: ${response.statusCode} ${response.body}`);
  }
  return (response.json() as { slug: string }).slug;
}
