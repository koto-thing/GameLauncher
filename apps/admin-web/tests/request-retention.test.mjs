import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { pruneRequestHistory } from "../lib/request-retention.ts";

// 本番DDLの外部キー関係を使い、D1の原子的なbatchをSQLiteで実行する
test("retention removes old completed requests and their logs while preserving active and referenced history", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE deployment_requests (request_id TEXT PRIMARY KEY, source_staging_request_id TEXT, created_at TEXT, state TEXT);
    CREATE TABLE request_approvers (request_id TEXT REFERENCES deployment_requests(request_id));
    CREATE TABLE approval_decisions (request_id TEXT REFERENCES deployment_requests(request_id));
    CREATE TABLE execution_attempts (request_id TEXT REFERENCES deployment_requests(request_id), created_at TEXT, started_at TEXT, finished_at TEXT);
    CREATE TABLE audit_events (request_id TEXT, occurred_at TEXT);`);

  const timestamp = Date.parse("2026-09-30T18:00:00.000Z");
  const cutoff = new Date(timestamp - 365 * 86400000).toISOString();
  const old = "2024-01-01T00:00:00.000Z";
  const recent = "2026-09-01T00:00:00.000Z";
  const insert = sqlite.prepare("INSERT INTO deployment_requests VALUES (?, ?, ?, ?)");

  for (const state of ["succeeded", "rejected", "cancelled", "failed_terminal", "ready", "pending_approval", "approved", "dispatched", "running", "failed_retryable", "recovery_required"]) {
    insert.run(state, null, old, state);
    sqlite.prepare("INSERT INTO request_approvers VALUES (?)").run(state);
    sqlite.prepare("INSERT INTO approval_decisions VALUES (?)").run(state);
    sqlite.prepare("INSERT INTO execution_attempts VALUES (?, ?, NULL, ?)").run(state, old, old);
    sqlite.prepare("INSERT INTO audit_events VALUES (?, ?)").run(state, old);
  }

  insert.run("boundary", null, cutoff, "succeeded");
  insert.run("source", null, old, "succeeded");
  insert.run("dependent", "source", recent, "approved");
  insert.run("updated", null, old, "succeeded");
  insert.run("executed", null, old, "succeeded");
  sqlite.prepare("INSERT INTO audit_events VALUES (?, ?)").run("updated", cutoff);
  sqlite.prepare("INSERT INTO audit_events VALUES (NULL, ?)").run(old);
  sqlite.prepare("INSERT INTO execution_attempts VALUES (?, ?, ?, ?)").run("executed", old, old, recent);

  const db = {
    prepare: (sql) => ({ bind: (...parameters) => ({ sql, parameters }) }),
    batch: async (statements) => {
      sqlite.exec("BEGIN");
      try {
        for (const { sql, parameters } of statements) sqlite.prepare(sql).run(...parameters);
        sqlite.exec("COMMIT");
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };

  try {
    const { default: worker } = await import("../dist/server/index.js");
    await worker.scheduled({ scheduledTime: timestamp }, { DB: db });
    await pruneRequestHistory(db, timestamp);

    for (const table of ["deployment_requests", "request_approvers", "approval_decisions", "execution_attempts", "audit_events"]) {
      assert.equal(sqlite.prepare(`SELECT count(*) AS count FROM ${table} WHERE request_id IN ('succeeded','rejected','cancelled','failed_terminal')`).get().count, 0);
    }

    const remaining = sqlite.prepare("SELECT request_id FROM deployment_requests ORDER BY request_id").all().map((row) => row.request_id);
    assert.deepEqual(remaining, ["approved", "boundary", "dependent", "dispatched", "executed", "failed_retryable", "pending_approval", "ready", "recovery_required", "running", "source", "updated"]);
    assert.equal(sqlite.prepare("SELECT count(*) AS count FROM audit_events WHERE request_id IS NULL").get().count, 1);
  } finally {
    sqlite.close();
  }
});
