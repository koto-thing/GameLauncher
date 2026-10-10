import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";

// Exercise production SQL against actual SQLite with D1-style transactional batches
export function sqliteDatabase(): { binding: D1Database; database: DatabaseSync } {
  const database = new DatabaseSync(":memory:");

  database.exec("PRAGMA foreign_keys = ON");
  database.exec(readFileSync(new NodeURL("../migrations/0001_play_analytics.sql", import.meta.url), "utf8"));

  // Bind values exactly as the Worker does and preserve SQL execution order
  function prepare(sql: string, args: Array<string | number | null> = []): unknown {
    return {
      bind(...values: Array<string | number | null>) { return prepare(sql, values); },
      async first() { return database.prepare(sql).get(...args) ?? null; },
      sql,
      args,
    };
  }

  const binding = {
    prepare,

    // Roll back the whole batch on a constraint or trigger failure
    async batch(statements: Array<{ sql: string; args: Array<string | number | null> }>) {
      database.exec("BEGIN");

      try {
        const results = statements.map((statement) => ({ success: true, results: database.prepare(statement.sql).all(...statement.args) }));

        database.exec("COMMIT");

        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;

  return { binding, database };
}
