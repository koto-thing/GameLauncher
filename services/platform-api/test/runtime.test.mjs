import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Miniflare } from "miniflare";

// Run the bundled production Worker in workerd with a real D1 database and rate-limit binding
test("workerd supports static validation, atomic D1 snapshots, administrator reads and deletion", async () => {
  const contents = await readFile(new URL("../.wrangler/test-worker/index.js", import.meta.url), "utf8");
  const mf = new Miniflare({ workers: [{ config: {
    name: "analytics-test", compatibilityDate: "2026-10-08",
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents } } },
    env: {
      ANALYTICS_DB: { type: "d1", id: "analytics-test-db" },
      INGEST_RATE_LIMITER: { type: "rate-limit", namespace: "1001", simple: { limit: 60, period: 60 } },
      ALLOWED_GAME_IDS: { type: "text", value: "test-game" },
      PLAY_ENVIRONMENT: { type: "text", value: "production" },
      ANALYTICS_READ_TOKEN: { type: "text", value: "s".repeat(64) },
    },
  } }] });

  try {
    const db = await mf.getD1Database("ANALYTICS_DB");
    const migration = await readFile(new URL("../migrations/0001_play_analytics.sql", import.meta.url), "utf8");

    // Preserve the trigger body as a single SQL statement while loading the migration
    for (const statement of migration.replace(/^--.*$/gm, "").split(/;\s*(?=CREATE\s|$)/).filter((value) => value.trim())) {
      await db.prepare(statement).run();
    }

    const ended = Date.now() - 60_000;
    const start = ended - 600_000;
    const japanDate = new Date(start + 9 * 3_600_000).toISOString().slice(0, 10);
    const installationId = crypto.randomUUID();
    const token = "a".repeat(64);
    const sessionId = crypto.randomUUID();
    const snapshot = {
      schemaVersion: 1, installationId, installationToken: token, sessions: [{
        sessionId, revision: 1, gameId: "test-game", gameVersion: "1.0.0", launcherVersion: "1.0.0", environment: "production",
        startedAt: new Date(start).toISOString(), lastObservedAt: new Date(ended).toISOString(), endedAt: new Date(ended).toISOString(),
        durationSeconds: 600, outcome: "normal", exitCode: 0, crashed: false,
        dailyDurations: [{ date: japanDate, durationSeconds: 600 }],
      }],
    };

    // Allocate a crossing-midnight session to both days even when this test runs near midnight
    const endDate = new Date(ended + 9 * 3_600_000).toISOString().slice(0, 10);

    if (endDate !== japanDate) {
      const midnight = Date.parse(`${endDate}T00:00:00+09:00`);
      const first = Math.floor((midnight - start) / 1000);

      snapshot.sessions[0].dailyDurations = [{ date: japanDate, durationSeconds: first }, { date: endDate, durationSeconds: 600 - first }];
    }

    for (let repeat = 0; repeat < 2; repeat++) {
      const response = await mf.dispatchFetch("https://analytics.test/v1/play-sessions", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(snapshot),
      });

      assert.equal(response.status, 200, await response.text());
    }

    const response = await mf.dispatchFetch(`https://analytics.test/v1/analytics/games?from=${japanDate}&to=${endDate}&environment=production`, {
      headers: { Authorization: `Bearer ${"s".repeat(64)}` },
    });
    const result = await response.json();

    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.games[0].launchAttempts, 1);
    assert.equal(result.games[0].totalDurationSeconds, 600);
    assert.equal(result.games[0].uniqueDevices, 1);

    const deletion = await mf.dispatchFetch(`https://analytics.test/v1/installations/${installationId}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
    });

    assert.equal(deletion.status, 204);
    assert.equal((await db.prepare("SELECT COUNT(*) count FROM play_sessions").first()).count, 0);
  } finally {
    await mf.dispose();
  }
});
