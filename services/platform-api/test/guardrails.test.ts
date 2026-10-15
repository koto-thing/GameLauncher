import assert from "node:assert/strict";
import { test } from "node:test";
import { handleRequest } from "../src/index.ts";
import { cachedAnalytics, invalidateReports } from "../src/report-cache.ts";
import { scheduledRetention } from "../src/storage.ts";
import { observeD1 } from "../../../packages/observability/d1.ts";
import { sqliteDatabase } from "./sqlite.ts";
import type { AnalyticsEnv } from "../src/types.ts";

const now = Date.parse("2026-10-15T03:00:00Z");
const url = new URL("https://analytics.test/v1/analytics/games?from=2026-10-01&to=2026-10-15");

// Count actual SQLite batches, not calls to the cache wrapper
function fixture() {
  const { binding, database } = sqliteDatabase();
  let queries = 0;
  const batch = binding.batch.bind(binding);
  binding.batch = ((statements: D1PreparedStatement[]) => { queries++; return batch(statements); }) as typeof binding.batch;
  const env: AnalyticsEnv = { ANALYTICS_DB: binding, ANALYTICS_READ_TOKEN: "s".repeat(64),
    PLAY_ENVIRONMENT: "production", ALLOWED_GAME_IDS: "test-game", INGEST_RATE_LIMITER: { async limit() { return { success: true }; } } };
  return { env, database, queries: () => queries };
}

test("identical concurrent reports execute once; canonical filters cache for 60 seconds", async () => {
  const { env, queries } = fixture();
  const reports = await Promise.all(Array.from({ length: 20 }, () => cachedAnalytics(env, url, now)));
  assert.equal(queries(), 1);
  reports.forEach((report) => assert.deepEqual(report, reports[0]));
  const reordered = new URL("https://other.test/v1/analytics/games?environment=production&to=2026-10-15&from=2026-10-01");
  await cachedAnalytics(env, reordered, now + 59_999);
  assert.equal(queries(), 1);
  await cachedAnalytics(env, url, now + 60_000);
  assert.equal(queries(), 2);
});

test("cache cannot bypass authentication, invalid filters, environment or emergency pause", async () => {
  const { env, queries } = fixture();
  await cachedAnalytics(env, url, now);
  assert.equal((await handleRequest(new Request(url), env, now)).status, 401);
  const request = new Request(url, { headers: { Authorization: `Bearer ${env.ANALYTICS_READ_TOKEN}` } });
  assert.equal((await handleRequest(request, { ...env, ANALYTICS_READS_ENABLED: "false" }, now)).status, 503);
  for (const query of ["&from=2026-10-01", "&installationId=secret", "&environment=staging"]) {
    await assert.rejects(cachedAnalytics(env, new URL(url + query), now), /invalid/);
  }
  assert.equal(queries(), 1);
  const other = fixture();
  await cachedAnalytics(other.env, url, now);
  assert.equal(other.queries(), 1);
});

test("different concurrent filters fail promptly and failures back off without more D1 work", async () => {
  const { env, queries } = fixture();
  const pending = cachedAnalytics(env, url, now);
  await assert.rejects(cachedAnalytics(env, new URL(url + "&gameId=test-game"), now), /busy/);
  await pending;
  invalidateReports(env.ANALYTICS_DB);
  let failures = 0;
  env.ANALYTICS_DB.batch = async () => { failures++; throw new Error("private database error"); };
  await assert.rejects(cachedAnalytics(env, url, now), /private database/);
  await assert.rejects(cachedAnalytics(env, url, now + 29_999), /busy/);
  assert.equal(failures, 1);
  await assert.rejects(cachedAnalytics(env, url, now + 60_000));
  assert.equal(failures, 2);
  assert.equal(queries(), 1);
});

test("deletion still works with collection paused and invalidates cached aggregates", async () => {
  const { env, queries } = fixture();
  env.ANALYTICS_INGEST_ENABLED = "false";
  await cachedAnalytics(env, url, now);
  const post = await handleRequest(new Request("https://analytics.test/v1/play-sessions", { method: "POST" }), env, now);
  assert.equal(post.status, 503);
  const result = await handleRequest(new Request("https://analytics.test/v1/installations/00000000-0000-4000-8000-000000000001", {
    method: "DELETE", headers: { Authorization: `Bearer ${"a".repeat(64)}` },
  }), env, now);
  assert.equal(result.status, 204);
  await cachedAnalytics(env, url, now);
  assert.equal(queries(), 3);
});

test("bounded cache evicts old filters and cannot repopulate after concurrent invalidation", async () => {
  const { env, queries } = fixture();
  for (let index = 0; index < 17; index++) await cachedAnalytics(env, new URL(url + `&gameId=game-${index}`), now);
  await cachedAnalytics(env, new URL(url + "&gameId=game-0"), now);
  assert.equal(queries(), 18);
  invalidateReports(env.ANALYTICS_DB);
  const pending = cachedAnalytics(env, url, now);
  invalidateReports(env.ANALYTICS_DB);
  await assert.rejects(pending, /changed during read/);
  await assert.rejects(cachedAnalytics(env, url, now), /busy/);
});

test("scheduled retention never deletes, requires dry-run and avoids database access by default", async () => {
  const { env, database } = fixture();
  const prepare = env.ANALYTICS_DB.prepare;
  env.ANALYTICS_DB.prepare = () => { throw new Error("unexpected database access"); };
  for (const mode of [undefined, "disabled", "enabled", "delete", "typo"]) {
    assert.deepEqual(await scheduledRetention({ ...env, ANALYTICS_RETENTION_MODE: mode }, now), { mode: "disabled" });
  }
  env.ANALYTICS_DB.prepare = prepare;
  const before = database.prepare("SELECT total_changes() changes").get();
  assert.deepEqual(await scheduledRetention({ ...env, ANALYTICS_RETENTION_MODE: "dry-run" }, now), {
    mode: "dry-run", cutoff: "2026-07-18", candidateSessions: 0, hasMore: false,
  });
  assert.deepEqual(database.prepare("SELECT total_changes() changes").get(), before);

  database.exec(`INSERT INTO installations VALUES ('fixture', 'digest', '2026-01-01', '2026-01-01');
    WITH RECURSIVE ids(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM ids WHERE n<150)
    INSERT INTO play_sessions(session_id,installation_id,revision,game_id,game_version,launcher_version,environment,
      started_at,started_date,last_observed_at,duration_seconds,outcome,received_at,write_id)
    SELECT 'session-'||n,'fixture',1,'test-game','1','1','production','2026-01-01','2026-01-01','2026-01-01',0,'running','2026-01-01','fixture' FROM ids`);
  const preview = await scheduledRetention({ ...env, ANALYTICS_RETENTION_MODE: "dry-run" }, now);
  assert.equal(preview.candidateSessions, 100);
  assert.equal(preview.hasMore, true);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM play_sessions").get()!.count, 150);
});

test("D1 metrics are optional, redact sensitive inputs and preserve cross-wrapper batch statements", async (t) => {
  const logs: string[] = [];
  t.mock.method(console, "info", (line: string) => logs.push(line));
  const native = { prepare(sql: string) { return { sql, bind(value: string) { return { sql, value }; } }; },
    async batch(items: object[]) { assert.equal(items[0], raw); return [{ success: true, meta: { rows_read: 12, rows_written: 2, duration: 4 } }]; } };
  assert.equal(observeD1(native, "test", false), native);
  const raw = native.prepare("private SQL");
  const source = { ...native, prepare() { return raw; } };
  const statement = observeD1(source, "test", true).prepare();
  await observeD1(source, "test", true).batch([statement]);
  assert.deepEqual(JSON.parse(logs[0]), { event: "d1_operation", database: "test", operation: "batch", outcome: "ok",
    rowsRead: 12, rowsWritten: 2, databaseMs: 4, elapsedMs: JSON.parse(logs[0]).elapsedMs });
  assert.doesNotMatch(logs.join(""), /private SQL/);
  const broken = observeD1({ async batch() { throw new Error("private credential"); } }, "test", true);
  await assert.rejects(broken.batch());
  assert.equal(JSON.parse(logs[1]).outcome, "error");
  assert.equal(JSON.parse(logs[1]).rowsRead, null);
  assert.doesNotMatch(logs.join(""), /private credential/);
});

test("local index plans constrain daily range queries", () => {
  const { database } = fixture();
  const facts = database.prepare("EXPLAIN QUERY PLAN SELECT * FROM analytics_daily WHERE environment=? AND date BETWEEN ? AND ?").all("production", "2026-10-01", "2026-10-15");
  const daily = database.prepare("EXPLAIN QUERY PLAN SELECT * FROM session_daily_durations WHERE date BETWEEN ? AND ?").all("2026-10-01", "2026-10-15");
  assert.match(JSON.stringify(facts), /analytics_daily_period/);
  assert.match(JSON.stringify(daily), /session_daily_date/);
});
