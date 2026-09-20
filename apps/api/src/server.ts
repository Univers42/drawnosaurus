import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { connectMongo, ensureIndexes } from "./mongo.ts";

/**
 * Entrypoint. Connect, ensure indexes, serve — and on a signal, stop accepting
 * connections before dropping the database handle so an in-flight write is not cut
 * off mid-request.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const mongo = await connectMongo(config.mongoUrl, config.dbName);
  await ensureIndexes(mongo.boards);

  const app = await buildApp({ config, mongo });

  if (config.authMode === "dev") {
    app.log.warn(
      `AUTH_MODE=dev: every request maps to owner "${config.devOwnerId}" unless it sends X-Owner-Id. Not for production.`,
    );
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      app.log.info(`${signal} received, shutting down`);
      void app
        .close()
        .then(() => mongo.close())
        .then(() => process.exit(0))
        .catch((error: unknown) => {
          app.log.error({ err: error }, "shutdown failed");
          process.exit(1);
        });
    });
  }

  await app.listen({ host: config.host, port: config.port });
}

main().catch((error: unknown) => {
  console.error("[api] failed to start:", error instanceof Error ? error.message : error);
  process.exit(1);
});
