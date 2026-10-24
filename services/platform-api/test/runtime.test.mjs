import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { Miniflare } from "miniflare";

// Run the bundled production Worker in workerd with a real D1 database and rate-limit binding
test("workerd supports static validation, atomic D1 snapshots, administrator reads and deletion", async () => {
  const contents = await readFile(new URL("../.wrangler/test-worker/index.js", import.meta.url), "utf8");
  const modules = { "index.js": { type: "esm", contents } };

  // Wrangler が出力した静的 Wasm を同じ workerd モジュール構成で読み込む
  for (const name of await readdir(new URL("../.wrangler/test-worker/", import.meta.url))) {
    if (name.endsWith(".wasm")) modules[name] = { type: "wasm", contents: await readFile(new URL(`../.wrangler/test-worker/${name}`, import.meta.url)) };
  }

  assert.ok(Object.keys(modules).some((name) => name.endsWith(".wasm")), "production bundle must contain Rust Wasm");
  const mf = new Miniflare({ workers: [{ config: {
    name: "analytics-test", compatibilityDate: "2026-10-08",
    manifest: { mainModule: "index.js", modules },
    env: {
      ANALYTICS_DB: { type: "d1", id: "analytics-test-db" },
      INGEST_RATE_LIMITER: { type: "rate-limit", namespace: "1001", simple: { limit: 60, period: 60 } },
      ALLOWED_GAME_IDS: { type: "text", value: "test-game" },
      PLAY_ENVIRONMENT: { type: "text", value: "production" },
      ANALYTICS_READ_TOKEN: { type: "text", value: "s".repeat(64) },
      D1_METRICS_ENABLED: { type: "text", value: "true" },
    },
  } }] });

  try {
    const db = await mf.getD1Database("ANALYTICS_DB");
    const migration = await readFile(new URL("../migrations/0001_play_analytics.sql", import.meta.url), "utf8");

    // Preserve the trigger body as a single SQL statement while loading the migration
    for (const statement of migration.replace(/^--.*$/gm, "").split(/;\s*(?=CREATE\s|$)/).filter((value) => value.trim())) {
      await db.prepare(statement).run();
    }
    const indexes = await readFile(new URL("../migrations/0002_analytics_read_indexes.sql", import.meta.url), "utf8");
    for (const statement of indexes.replace(/^--.*$/gm, "").split(";").filter((value) => value.trim())) await db.prepare(statement).run();

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

    // Rust の各判定を HTTP 経由で実行し拒否したデータが D1 に残らないことを確認する
    for (const [overrides, message] of [
      [{ durationSeconds: 603 }, "invalid session timing"],
      [{ exitCode: 1 }, "invalid session outcome"],
      [{ dailyDurations: [{ date: japanDate, durationSeconds: 604 }] }, "invalid daily duration"],
      [{ gameId: "unknown-game" }, "unknown game, environment, or duplicate session"],
      [{ dailyDurations: [] }, "daily duration total does not match session"],
    ]) {
      const invalid = structuredClone(snapshot);
      Object.assign(invalid.sessions[0], overrides);
      const response = await mf.dispatchFetch("https://analytics.test/v1/play-sessions", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(invalid),
      });

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: message });
      assert.equal((await db.prepare("SELECT COUNT(*) count FROM play_sessions").first()).count, 0);
    }

    // 大文字小文字だけ異なる重複もバッチ全体で拒否する
    const duplicate = structuredClone(snapshot);
    duplicate.sessions.push({ ...structuredClone(duplicate.sessions[0]), sessionId: sessionId.toUpperCase() });
    const rejected = await mf.dispatchFetch("https://analytics.test/v1/play-sessions", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(duplicate),
    });

    assert.equal(rejected.status, 400);
    assert.deepEqual(await rejected.json(), { error: "unknown game, environment, or duplicate session" });
    assert.equal((await db.prepare("SELECT COUNT(*) count FROM play_sessions").first()).count, 0);

    // Content-Length に頼らずストリーム中の一 MiB 超過を JSON 解析前に拒否する
    const oversized = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(524_288).fill(32));
        controller.enqueue(new Uint8Array(524_289).fill(32));
        controller.close();
      },
    });
    const tooLarge = await mf.dispatchFetch("https://analytics.test/v1/play-sessions", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: oversized, duplex: "half",
    });

    assert.equal(tooLarge.status, 413);
    assert.deepEqual(await tooLarge.json(), { error: "request body too large" });
    assert.equal((await db.prepare("SELECT COUNT(*) count FROM play_sessions").first()).count, 0);

    for (let repeat = 0; repeat < 2; repeat++) {
      // Rust が大文字の UUID を正規化した後も同じセッションの再送として扱う
      const payload = structuredClone(snapshot);
      payload.installationId = installationId.toUpperCase();
      payload.sessions[0].sessionId = sessionId.toUpperCase();
      const response = await mf.dispatchFetch("https://analytics.test/v1/play-sessions", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });

      assert.equal(response.status, 200, await response.text());
    }

    // 境界ちょうどの一 MiB バッチは受理し再送として集計を維持する
    const json = JSON.stringify(snapshot);
    const atLimit = await mf.dispatchFetch("https://analytics.test/v1/play-sessions", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: json + " ".repeat(1_048_576 - new TextEncoder().encode(json).length),
    });

    assert.equal(atLimit.status, 200, await atLimit.text());
    assert.equal((await db.prepare("SELECT session_id FROM play_sessions").first()).session_id, sessionId.toLowerCase());

    const responses = await Promise.all(Array.from({ length: 10 }, () => mf.dispatchFetch(`https://analytics.test/v1/analytics/games?from=${japanDate}&to=${endDate}&environment=production`, {
      headers: { Authorization: `Bearer ${"s".repeat(64)}` },
    })));
    for (const item of responses) assert.equal(item.status, 200);
    const response = responses[0];
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
