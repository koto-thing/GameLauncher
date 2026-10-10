import assert from "node:assert/strict";
import { test } from "node:test";
import { handleRequest } from "../src/index.ts";
import { archiveDetails, saveBatch } from "../src/storage.ts";
import { readAnalytics } from "../src/analytics.ts";
import { validateBatch } from "../src/validation.ts";
import type { AnalyticsEnv, PlaySession, PlaySessionBatch } from "../src/types.ts";
import { sqliteDatabase } from "./sqlite.ts";

const now = Date.parse("2026-10-11T03:00:00Z");
const install = "00000000-0000-4000-8000-000000000001";
const token = "a".repeat(64);

// Create independent databases and production-equivalent runtime bindings for each scenario
function fixture() {
  const { binding, database } = sqliteDatabase();
  const env: AnalyticsEnv = {
    ANALYTICS_DB: binding, INGEST_RATE_LIMITER: { async limit() { return { success: true }; } },
    ALLOWED_GAME_IDS: "test-game,other-game", ANALYTICS_READ_TOKEN: "s".repeat(64), PLAY_ENVIRONMENT: "production",
  };

  return { env, database };
}

// Supply valid complete sessions with explicit Japanese daily duration allocation
function session(overrides: Partial<PlaySession> = {}): PlaySession {
  return {
    sessionId: crypto.randomUUID(), revision: 1, gameId: "test-game", gameVersion: "1.0.0", launcherVersion: "1.0.0",
    environment: "production", startedAt: "2026-10-10T00:00:00.000Z", lastObservedAt: "2026-10-10T00:10:00.000Z",
    endedAt: "2026-10-10T00:10:00.000Z", durationSeconds: 600, outcome: "normal", exitCode: 0, crashed: false,
    dailyDurations: [{ date: "2026-10-10", durationSeconds: 600 }], ...overrides,
  };
}

// Construct opted-in upload envelopes without allowing tests to share mutable snapshots
function batch(sessions: PlaySession[], installationId = install, installationToken = token): PlaySessionBatch {
  return { schemaVersion: 1, installationId, installationToken, sessions: structuredClone(sessions) };
}

// Send snapshots through the complete validation and HTTP path
async function upload(env: AnalyticsEnv, payload: PlaySessionBatch, instant = now): Promise<Response> {
  return handleRequest(new Request("https://analytics.test/v1/play-sessions", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  }), env, instant);
}

// Read the same aggregate report consumed by the administrator proxy
async function report(env: AnalyticsEnv, query = "from=2026-10-09&to=2026-10-11", instant = now) {
  return readAnalytics(env, new URL(`https://analytics.test/v1/analytics/games?${query}&environment=production`), instant);
}

test("cumulative snapshots and out-of-order retries count one session and never lose duration", async () => {
  const { env, database } = fixture();
  const initial = session({ outcome: "running", endedAt: null, exitCode: null, crashed: null });
  const final = session({ ...initial, revision: 2, durationSeconds: 900, lastObservedAt: "2026-10-10T00:15:00Z", endedAt: "2026-10-10T00:15:00Z",
    outcome: "normal", exitCode: 0, crashed: false, dailyDurations: [{ date: "2026-10-10", durationSeconds: 900 }] });

  assert.equal((await upload(env, batch([initial]))).status, 200);
  assert.equal((await upload(env, batch([final]))).status, 200);
  assert.equal((await upload(env, batch([initial]))).status, 200);
  assert.equal((await upload(env, batch([final]))).status, 200);

  const game = (await report(env)).games[0];

  assert.equal(game.launchAttempts, 1);
  assert.equal(game.successfulLaunches, 1);
  assert.equal(game.totalDurationSeconds, 900);
  assert.equal(game.averageDurationSeconds, 900);
  assert.equal(game.counts.normal, 1);
  assert.equal(game.counts.running, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM session_daily_durations").get()!.count, 1);
});

test("same-revision conflicting daily allocation cannot overwrite a snapshot", async () => {
  const { env } = fixture();
  const original = session({ startedAt: "2026-10-09T14:55:00Z", lastObservedAt: "2026-10-09T15:05:00Z", endedAt: "2026-10-09T15:05:00Z",
    dailyDurations: [{ date: "2026-10-09", durationSeconds: 300 }, { date: "2026-10-10", durationSeconds: 300 }] });
  const changed = { ...original, dailyDurations: [{ date: "2026-10-09", durationSeconds: 299 }, { date: "2026-10-10", durationSeconds: 301 }] };

  assert.equal((await upload(env, batch([original]))).status, 200);
  assert.equal((await upload(env, batch([changed]))).status, 200);

  const days = (await report(env)).games[0].daily;

  assert.equal(days.find((day) => day.date === "2026-10-09")!.durationSeconds, 300);
  assert.equal(days.find((day) => day.date === "2026-10-10")!.durationSeconds, 300);
});

test("session ownership conflicts roll back the entire batch", async () => {
  const { env, database } = fixture();
  const owned = session();

  assert.equal((await upload(env, batch([owned]))).status, 200);
  assert.equal((await upload(env, batch([session(), owned], "00000000-0000-4000-8000-000000000002", "b".repeat(64)))).status, 409);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM play_sessions").get()!.count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM installations").get()!.count, 1);
  assert.equal((await upload(env, batch([session()], install, "b".repeat(64)))).status, 401);
});

test("final sessions and cumulative durations cannot be rewritten by newer revisions", async () => {
  const { env } = fixture();
  const completed = session();

  await upload(env, batch([completed]));

  assert.equal((await upload(env, batch([{ ...completed, revision: 2, outcome: "interrupted", exitCode: null, crashed: null }]))).status, 409);
  assert.equal((await report(env)).games[0].counts.normal, 1);
});

test("privacy deletion removes device records, revokes stale uploads, and is repeatable", async () => {
  const { env, database } = fixture();

  await upload(env, batch([session()]));

  const request = () => new Request(`https://analytics.test/v1/installations/${install}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });

  assert.equal((await handleRequest(request(), env, now)).status, 204);
  assert.equal((await handleRequest(request(), env, now)).status, 204);

  for (const table of ["installations", "play_sessions", "session_daily_durations"]) {
    assert.equal(database.prepare(`SELECT COUNT(*) count FROM ${table}`).get()!.count, 0);
  }

  assert.equal((await upload(env, batch([session()]))).status, 401);
  assert.equal((await report(env)).games.length, 0);
});

test("Japanese midnight splits duration while failures stay outside duration distributions", async () => {
  const { env } = fixture();

  await upload(env, batch([
    session({ startedAt: "2026-10-09T14:55:00Z", lastObservedAt: "2026-10-09T15:05:00Z", endedAt: "2026-10-09T15:05:00Z",
      dailyDurations: [{ date: "2026-10-09", durationSeconds: 300 }, { date: "2026-10-10", durationSeconds: 300 }] }),
    session({ durationSeconds: 0, outcome: "launch_failed", exitCode: null, crashed: null, dailyDurations: [] }),
    session({ outcome: "abnormal", exitCode: null, crashed: true }),
  ]));

  const game = (await report(env)).games[0];

  assert.equal(game.launchAttempts, 3);
  assert.equal(game.successfulLaunches, 2);
  assert.equal(game.uniqueDevices, 1);
  assert.equal(game.totalDurationSeconds, 1200);
  assert.equal(game.medianDurationSeconds, 600);
  assert.equal(game.durationHistogram.reduce((sum, item) => sum + item.count, 0), 2);
  assert.equal(game.counts.abnormal, 1);
  assert.equal(game.daily[0].durationSeconds, 300);
  assert.equal(game.daily[1].durationSeconds, 900);
  assert.equal(game.daily[0].uniqueDevices, 1);
  assert.equal(game.daily[1].uniqueDevices, 1);

  const nextDay = (await report(env, "from=2026-10-10&to=2026-10-10")).games[0];

  assert.equal(nextDay.uniqueDevices, 1);
  assert.equal(nextDay.retention.nextDay.returnedDevices, 0);
});

test("expired sessions archive exactly once and retain anonymous totals after deletion", async () => {
  const { env, database } = fixture();
  const old = session({ startedAt: "2026-07-10T14:55:00Z", lastObservedAt: "2026-07-10T15:05:00Z", endedAt: "2026-07-10T15:05:00Z",
    dailyDurations: [{ date: "2026-07-10", durationSeconds: 300 }, { date: "2026-07-11", durationSeconds: 300 }] });

  await saveBatch(env, batch([old]), Date.parse("2026-07-11T01:00:00Z"));

  const query = "from=2026-07-01&to=2026-10-11";
  const before = (await report(env, query)).games[0];

  await archiveDetails(env, now);
  await archiveDetails(env, now);

  const after = (await report(env, query)).games[0];

  assert.equal(after.launchAttempts, before.launchAttempts);
  assert.equal(after.totalDurationSeconds, 600);
  assert.equal(after.averageDurationSeconds, 600);
  assert.equal(after.uniqueDevices, null);
  assert.equal(after.retention.day7.eligibleDevices, null);
  assert.equal(after.detailAvailable, false);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM play_sessions").get()!.count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM installations").get()!.count, 0);

  await handleRequest(new Request(`https://analytics.test/v1/installations/${install}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }), env, now);

  assert.equal((await report(env, query)).games[0].totalDurationSeconds, 600);
});

test("retention uses first observed successful use and excludes incomplete return days", async () => {
  const { env } = fixture();

  // The first user returned at D1 and D7, including a game version change
  const byDate = (date: string, version = "1.0.0") => session({ gameVersion: version, startedAt: `${date}T00:00:00Z`, lastObservedAt: `${date}T00:10:00Z`, endedAt: `${date}T00:10:00Z`, dailyDurations: [{ date, durationSeconds: 600 }] });

  await upload(env, batch([byDate("2026-10-03"), byDate("2026-10-04"), byDate("2026-10-10", "2.0.0")]));
  await upload(env, batch([byDate("2026-10-11")], "00000000-0000-4000-8000-000000000002", "b".repeat(64)));

  const game = (await report(env, "from=2026-10-01&to=2026-10-11")).games[0];

  assert.deepEqual(game.retention.nextDay, { eligibleDevices: 1, returnedDevices: 1, rate: 1 });
  assert.deepEqual(game.retention.day7, { eligibleDevices: 1, returnedDevices: 1, rate: 1 });
  assert.deepEqual(game.versions, ["1.0.0", "2.0.0"]);
});

test("stale running checkpoints count as interrupted without preventing a later final snapshot", async () => {
  const { env, database } = fixture();
  const running = session({ startedAt: "2026-10-11T02:50:00Z", lastObservedAt: "2026-10-11T02:59:00Z",
    durationSeconds: 540, outcome: "running", endedAt: null, exitCode: null, crashed: null,
    dailyDurations: [{ date: "2026-10-11", durationSeconds: 540 }] });

  assert.equal((await upload(env, batch([running]))).status, 200);
  assert.equal((await report(env)).games[0].counts.running, 1);

  const later = now + 10 * 60_000;

  assert.equal((await report(env, undefined, later)).games[0].counts.interrupted, 1);
  assert.equal(database.prepare("SELECT outcome FROM play_sessions").get()!.outcome, "running");

  const completed = { ...running, revision: 2, lastObservedAt: "2026-10-11T03:05:00Z", endedAt: "2026-10-11T03:05:00Z",
    durationSeconds: 900, outcome: "normal" as const, exitCode: 0, crashed: false, dailyDurations: [{ date: "2026-10-11", durationSeconds: 900 }] };

  assert.equal((await upload(env, batch([completed]), later)).status, 200);
  assert.equal((await report(env, undefined, later)).games[0].counts.normal, 1);
});

test("overnight activity counts devices and next-day retention without another launch", async () => {
  const { env } = fixture();

  await upload(env, batch([session({ startedAt: "2026-10-09T14:55:00Z", lastObservedAt: "2026-10-09T15:05:00Z", endedAt: "2026-10-09T15:05:00Z",
    dailyDurations: [{ date: "2026-10-09", durationSeconds: 300 }, { date: "2026-10-10", durationSeconds: 300 }] })]));

  const whole = (await report(env)).games[0];
  const day2 = (await report(env, "from=2026-10-10&to=2026-10-10")).games[0];

  assert.deepEqual(whole.retention.nextDay, { eligibleDevices: 1, returnedDevices: 1, rate: 1 });
  assert.equal(day2.launchAttempts, 0);
  assert.equal(day2.totalDurationSeconds, 300);
  assert.equal(day2.uniqueDevices, 1);
  assert.equal(day2.daily[0].uniqueDevices, 1);
});

test("concurrent first uploads cannot take over another installation credential", async () => {
  const { env, database } = fixture();
  const responses = await Promise.all([upload(env, batch([session()])), upload(env, batch([session()], install, "b".repeat(64)))]);

  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 401]);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM installations").get()!.count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM play_sessions").get()!.count, 1);
});

test("schema and semantic validation reject unknown games, malformed dates, duration fraud and environment mixing", async () => {
  const { env } = fixture();

  for (const bad of [
    session({ gameId: "unknown-game" }), session({ environment: "staging" }), session({ startedAt: "2026-02-30T00:00:00Z" }),
    session({ durationSeconds: 700, dailyDurations: [{ date: "2026-10-10", durationSeconds: 700 }] }),
    session({ dailyDurations: [{ date: "2026-10-10", durationSeconds: 1 }] }),
    session({ dailyDurations: [{ date: "2026-10-11", durationSeconds: 600 }] }),
    session({ startedAt: "2026-01-01T00:00:00Z" }),
  ]) {
    assert.equal((await upload(env, batch([bad]))).status, 400);
  }

  assert.throws(() => validateBatch(batch(Array.from({ length: 101 }, () => session())), env, now));
  assert.equal((await report(env)).games.length, 0);
});

test("aggregate reads require a server credential and enforce real inclusive date filters", async () => {
  const { env } = fixture();
  const url = "https://analytics.test/v1/analytics/games?from=2026-10-01&to=2026-10-11&environment=production";

  assert.equal((await handleRequest(new Request(url), env, now)).status, 401);
  assert.equal((await handleRequest(new Request(url, { headers: { Authorization: `Bearer ${env.ANALYTICS_READ_TOKEN}` } }), env, now)).status, 200);
  assert.equal((await handleRequest(new Request(url.replace("2026-10-01", "2026-02-30"), { headers: { Authorization: `Bearer ${env.ANALYTICS_READ_TOKEN}` } }), env, now)).status, 400);

  env.INGEST_RATE_LIMITER = { async limit() { return { success: false }; } };

  assert.equal((await upload(env, batch([session()]))).status, 429);
});
