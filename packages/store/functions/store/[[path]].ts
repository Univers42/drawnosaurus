import { d1Store, type D1Database } from "../../src/d1.ts";
import { handle } from "../../src/handlers.ts";

/** The bindings wrangler.toml declares. */
interface Env {
  STORE: D1Database;
}

/**
 * Every request to `/store/*` on the Pages site. Thin on purpose: what each method may do is
 * the handlers' (`src/handlers.ts`), and the platform's limits are in `src/limits.ts`.
 */
export const onRequest = ({ request, env }: { request: Request; env: Env }): Promise<Response> =>
  handle(request, d1Store(env.STORE));
