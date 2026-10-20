import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { D1Database, D1PreparedStatement, D1Result } from "../src/d1.ts";

export interface Statement {
  sql: string;
  values: SQLInputValue[];
}

/** One call the store made: a statement run on its own, or a batch of them. */
export type D1Call =
  { kind: "one"; statement: Statement } | { kind: "batch"; statements: Statement[] };

interface Recorded extends D1PreparedStatement, Statement {}

/**
 * A `D1Database` over Node's own SQLite with the store's migration applied, recording every
 * call. D1 is SQLite, so the store's SQL runs for real here. `batch` runs in one transaction
 * and rolls back on a failure, as D1 documents: "Batched statements are SQL transactions. If
 * a statement in the sequence fails, then an error is returned for that specific statement,
 * and it aborts or rolls back the entire sequence."
 * (https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
 */
export function sqliteD1(): D1Database & { sqlite: DatabaseSync; calls: D1Call[] } {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8"));
  const calls: D1Call[] = [];

  const execute = <T>({ sql, values }: Statement): D1Result<T> => {
    const prepared = sqlite.prepare(sql);
    if (/^\s*SELECT\b/i.test(sql)) {
      return { results: prepared.all(...values) as T[], meta: { changes: 0 } };
    }
    return { results: [], meta: { changes: Number(prepared.run(...values).changes) } };
  };

  const statement = (sql: string, values: SQLInputValue[]): Recorded => ({
    sql,
    values,
    bind: (...next) => statement(sql, next),
    first: async <T>() => {
      calls.push({ kind: "one", statement: { sql, values } });
      return execute<T>({ sql, values }).results[0] ?? null;
    },
    all: async <T>() => {
      calls.push({ kind: "one", statement: { sql, values } });
      return execute<T>({ sql, values });
    },
  });

  return {
    sqlite,
    calls,
    prepare: (sql) => statement(sql, []),
    batch: async <T>(statements: D1PreparedStatement[]) => {
      const recorded = statements as Recorded[];
      calls.push({
        kind: "batch",
        statements: recorded.map(({ sql, values }) => ({ sql, values })),
      });
      sqlite.exec("BEGIN");
      try {
        const results = recorded.map((one) => execute<T>(one));
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
