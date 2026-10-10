import assert from "node:assert/strict";
import { createAdminTestHarness } from "./helpers/admin-worker-harness.mjs";
import test from "node:test";
import { pruneRequestHistory } from "../lib/request-retention.ts";

// 本番DDLの外部キー関係とD1を使い、ビルド済みWorkerのCron処理を検証する
test("retention removes old completed requests and their logs while preserving active and referenced history", async (t) => {
  const server = createAdminTestHarness();

  t.after(() => server.close());

  await server.listen();

  const worker = server.getWorker();
  const { DB: db } = await worker.getEnv();

  await db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE deployment_requests (request_id TEXT PRIMARY KEY, source_staging_request_id TEXT, created_at TEXT, state TEXT);
    CREATE TABLE request_approvers (request_id TEXT REFERENCES deployment_requests(request_id));
    CREATE TABLE approval_decisions (request_id TEXT REFERENCES deployment_requests(request_id));
    CREATE TABLE execution_attempts (request_id TEXT REFERENCES deployment_requests(request_id), created_at TEXT, started_at TEXT, finished_at TEXT);
    CREATE TABLE audit_events (request_id TEXT, occurred_at TEXT);`);

  const timestamp = Date.parse("2026-09-30T18:00:00.000Z");
  const cutoff = new Date(timestamp - 365 * 86400000).toISOString();
  const old = "2024-01-01T00:00:00.000Z";
  const recent = "2026-09-01T00:00:00.000Z";
  const insert = db.prepare("INSERT INTO deployment_requests VALUES (?, ?, ?, ?)");

  for (const state of ["succeeded", "rejected", "cancelled", "failed_terminal", "ready", "pending_approval", "approved", "dispatched", "running", "failed_retryable", "recovery_required"]) {
    await insert.bind(state, null, old, state).run();
    await db.prepare("INSERT INTO request_approvers VALUES (?)").bind(state).run();
    await db.prepare("INSERT INTO approval_decisions VALUES (?)").bind(state).run();
    await db.prepare("INSERT INTO execution_attempts VALUES (?, ?, NULL, ?)").bind(state, old, old).run();
    await db.prepare("INSERT INTO audit_events VALUES (?, ?)").bind(state, old).run();
  }

  await insert.bind("boundary", null, cutoff, "succeeded").run();
  await insert.bind("source", null, old, "succeeded").run();
  await insert.bind("dependent", "source", recent, "approved").run();
  await insert.bind("updated", null, old, "succeeded").run();
  await insert.bind("executed", null, old, "succeeded").run();
  await db.prepare("INSERT INTO audit_events VALUES (?, ?)").bind("updated", cutoff).run();
  await db.prepare("INSERT INTO audit_events VALUES (NULL, ?)").bind(old).run();
  await db.prepare("INSERT INTO execution_attempts VALUES (?, ?, ?, ?)").bind("executed", old, old, recent).run();

  await worker.scheduled({ scheduledTime: new Date(timestamp) });
  await pruneRequestHistory(db, timestamp);

  for (const table of ["deployment_requests", "request_approvers", "approval_decisions", "execution_attempts", "audit_events"]) {
    assert.equal(await db.prepare(`SELECT count(*) AS count FROM ${table} WHERE request_id IN ('succeeded','rejected','cancelled','failed_terminal')`).first("count"), 0);
  }

  const remaining = (await db.prepare("SELECT request_id FROM deployment_requests ORDER BY request_id").all()).results.map((row) => row.request_id);
  assert.deepEqual(remaining, ["approved", "boundary", "dependent", "dispatched", "executed", "failed_retryable", "pending_approval", "ready", "recovery_required", "running", "source", "updated"]);
  assert.equal(await db.prepare("SELECT count(*) AS count FROM audit_events WHERE request_id IS NULL").first("count"), 1);
});
