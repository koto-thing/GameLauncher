import assert from "node:assert/strict";
import { test } from "node:test";
import { validateBatch } from "../src/validation.ts";
import { validateBatch as previous } from "./fixtures/previous-validation.ts";

const now = Date.parse("2026-10-11T03:00:00Z");
const env = { ALLOWED_GAME_IDS: "test-game,other-game", PLAY_ENVIRONMENT: "production" };

/**
 * 比較に使う独立した正常バッチを作る
 * @returns {object} 正常な JSON バッチ
 */
function fixture() {
  return {
    schemaVersion: 1, installationId: "ABCDEF00-0000-4000-8000-000000000001", installationToken: "a".repeat(64),
    sessions: [{
      sessionId: "ABCDEF00-0000-4000-8000-000000000002", revision: 1,
      gameId: "test-game", gameVersion: "1.0.0", launcherVersion: "1.0.0", environment: "production",
      startedAt: "2026-10-10T00:00:00Z", lastObservedAt: "2026-10-10T00:10:00Z", endedAt: "2026-10-10T00:10:00Z",
      durationSeconds: 600, outcome: "normal", exitCode: 0, crashed: false,
      dailyDurations: [{ date: "2026-10-10", durationSeconds: 600 }],
    }],
  };
}

/**
 * 検証結果と既存のエラーメッセージを比較可能な値に変換する
 * @param {Function} validate 比較する検証関数
 * @param {unknown} value 受信 JSON
 * @param {object} config 許可ゲームと環境
 * @returns {object} 正常化結果またはエラーメッセージ
 */
function result(validate, value, config = env) {
  try {
    return { value: validate(structuredClone(value), config, now) };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * 同じ入力に対する移行前後の結果を照合する
 * @param {unknown} value 比較対象の JSON
 * @param {object} config 許可ゲームと環境
 * @returns {void} 不一致の場合はテストを失敗させる
 */
function compare(value, config = env) {
  assert.deepEqual(result(validateBatch, value, config), result(previous, value, config), JSON.stringify(value));
}

// Schema を含めた全入口フィールドと誤りの優先順位を確認する
test("whole-batch Rust boundary preserves schema failures and error precedence", () => {
  compare(fixture());

  for (const value of [null, false, 1, "batch", [], {}, { ...fixture(), extra: true }]) compare(value);

  for (const key of Object.keys(fixture())) {
    const missing = fixture();
    delete missing[key];
    compare(missing);

    for (const invalid of [null, false, 0, "", [], {}]) compare({ ...fixture(), [key]: invalid });
  }

  for (const key of Object.keys(fixture().sessions[0])) {
    const missing = fixture();
    delete missing.sessions[0][key];
    compare(missing);

    for (const invalid of [null, false, 0, "", [], {}]) {
      const value = fixture();
      value.sessions[0][key] = invalid;
      compare(value);
    }
  }

  for (const overrides of [
    { gameId: "other-game", lastObservedAt: "2016-12-31T23:59:60Z", outcome: "abnormal", dailyDurations: [] },
    { gameId: "unknown-game", startedAt: "2016-12-31T23:59:60Z" },
    { startedAt: "2016-12-31T23:59:60Z", exitCode: 2, dailyDurations: [] },
    { exitCode: 2, dailyDurations: [] },
    { dailyDurations: [{ date: "2026-10-10", durationSeconds: 599 }] },
    { dailyDurations: [{ date: "2026-10-10", durationSeconds: 300 }, { date: "2026-10-10", durationSeconds: 300 }] },
  ]) {
    const value = fixture();
    Object.assign(value.sessions[0], overrides);
    compare(value);
  }
});

// 固定 seed の変異で異常値の組み合わせとセッション間の制約を比較する
test("deterministic batch mutation fuzz preserves Rust validation and normalization", () => {
  let seed = 0x12345678;
  const values = {
    revision: [1, 2147483647, 0, 1.5], gameId: ["test-game", "other-game", "unknown-game"],
    gameVersion: ["1.0.0", "a".repeat(64), "a".repeat(65), "1\n", "日本語"],
    environment: ["production", "staging", "unknown"],
    startedAt: ["2026-10-10T00:00:00Z", "2026-10-10T00:00:00.1Z", "2026-07-01T00:00:00Z", "2026-10-11T03:05:00.001Z", "2016-12-31T23:59:60Z"],
    lastObservedAt: ["2026-10-10T00:10:00Z", "2026-10-10T00:10:00.001Z", "2026-10-09T23:59:59Z"],
    endedAt: [null, "2026-10-10T00:10:00Z", "2026-10-10T00:10:00.01Z"],
    durationSeconds: [0, 1, 599, 600, 602, 603, 2592000],
    outcome: ["running", "normal", "abnormal", "interrupted", "launch_failed"],
    exitCode: [null, -2147483648, -1, 0, 1, 2147483647], crashed: [null, false, true],
    dailyDurations: [[], [{ date: "2026-10-10", durationSeconds: 600 }], [{ date: "2026-10-10", durationSeconds: 599 }], [{ date: "2026-10-10\n", durationSeconds: 600 }]],
  };
  const fields = Object.keys(values);

  for (let index = 0; index < 2500; index++) {
    const value = fixture();

    for (let mutation = 0; mutation < 1 + index % 4; mutation++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const key = fields[seed % fields.length];
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      value.sessions[0][key] = structuredClone(values[key][seed % values[key].length]);
    }

    if (index % 7 === 0) value.sessions.push({ ...structuredClone(value.sessions[0]), sessionId: value.sessions[0].sessionId.toLowerCase() });
    compare(value);
  }
});

// ECMAScript の空白集合と境界のバッチ件数を比較する
test("Rust batch boundary preserves allowlist trimming, UUID folding and batch limits", () => {
  for (const whitespace of [" ", "\t", "\n", "\ufeff", "\u00a0", "\u0085", "\u2007", "\u2028", "\u3000"]) {
    compare(fixture(), { ...env, ALLOWED_GAME_IDS: `${whitespace}test-game${whitespace},,` });
  }

  for (const count of [0, 1, 100, 101]) {
    const value = fixture();
    const original = value.sessions[0];
    value.sessions = Array.from({ length: count }, (_, index) => ({ ...structuredClone(original), sessionId: `abcdef00-0000-4000-8000-${String(index).padStart(12, "0")}` }));
    compare(value);
  }
});

// UTC の桁数と暦日と改行や閏秒の端を比較する
test("Rust date parsing preserves schema and JavaScript date edge cases", () => {
  for (const timestamp of [
    "2026-10-10T00:00:00Z", "2026-10-10T00:00:00.0Z", "2026-10-10T00:00:00.001Z",
    "2026-10-10T00:00:00.999Z", "2026-10-10T00:00:00.0000Z", "2026-10-10T00:00:00Z\n",
    "2026-02-29T00:00:00Z", "2024-02-29T00:00:00Z", "0000-01-01T00:00:00Z",
    "0099-01-01T00:00:00Z", "2016-12-31T23:59:60Z", "2026-10-10T24:00:00Z",
  ]) {
    const value = fixture();
    value.sessions[0].startedAt = timestamp;
    compare(value);
  }

  for (const date of ["2026-10-10", "2026-10-10\n", "2026-10-10\r", "2026-10-10\r\n", "2026-02-29", "0000-01-01"]) {
    const value = fixture();
    value.sessions[0].lastObservedAt = "2026-10-11T00:00:00Z";
    value.sessions[0].endedAt = value.sessions[0].lastObservedAt;
    value.sessions[0].dailyDurations[0].date = date;
    compare(value);
  }
});

// 最大件数の正常バッチを全日配分して文字列境界と配列境界を同時に確認する
test("Rust validates the maximum 100 sessions and 91 daily allocations without changing results", () => {
  const clock = Date.parse("2026-10-11T14:59:59.999Z");
  const day = 86_400_000;
  const cutoff = new Date(clock - 89 * day + 32_400_000).toISOString().slice(0, 10);
  const start = Date.parse(`${cutoff}T00:00:00+09:00`);
  const value = fixture();
  const session = {
    ...value.sessions[0], startedAt: new Date(start).toISOString(), lastObservedAt: new Date(clock + 1).toISOString(),
    endedAt: null, outcome: "running", exitCode: null, crashed: null, durationSeconds: 0,
    dailyDurations: Array.from({ length: 91 }, (_, index) => ({ date: new Date(start + index * day + 32_400_000).toISOString().slice(0, 10), durationSeconds: 0 })),
  };
  value.sessions = Array.from({ length: 100 }, (_, index) => ({ ...structuredClone(session), sessionId: `abcdef00-0000-4000-8000-${String(index).padStart(12, "0")}` }));

  // 本番の受信上限に収まる正常な入力で比較する
  assert.ok(new TextEncoder().encode(JSON.stringify(value)).length < 1_048_576);
  assert.deepEqual(validateBatch(structuredClone(value), env, clock), previous(structuredClone(value), env, clock));
});
