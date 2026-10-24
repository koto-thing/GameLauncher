import validationModule from "./generated/analytics-validation.wasm";
import type { ValidateFunction } from "ajv";
import { validatePlaySessions } from "./generated/play-sessions.js";
import type { AnalyticsEnv, PlaySessionBatch } from "./types.ts";

const validateSchema = validatePlaySessions as ValidateFunction<PlaySessionBatch>;

// 静的インポートした Rust Wasm を isolate ごとに一度だけ初期化する
const rust = new WebAssembly.Instance(validationModule).exports as unknown as {
  valid_timing(start: number, observed: number, ended: number, now: number, duration: number, running: number): number;
  valid_outcome(outcome: number, exitCode: number, crashed: number, duration: number): number;
  valid_daily(start: number, observed: number, dayStart: number, duration: number): number;
};

const outcomes = { running: 0, normal: 1, abnormal: 2, interrupted: 3, launch_failed: 4 };

export const DAY_MS = 86_400_000;

// Convert an instant to its Japanese calendar date
export function japanDate(instant: number): string {
  return new Date(instant + 9 * 3_600_000).toISOString().slice(0, 10);
}

// Keep detailed records for the current Japanese date and the previous 89 days
export function detailCutoff(now: number): string {
  return japanDate(now - 89 * DAY_MS);
}

/**
 * 累積スナップショットの構造と整合性を検証する
 * @param value 受信した JSON データ
 * @param env 許可ゲームと実行環境
 * @param now 検証時刻の Unix ミリ秒
 * @returns 正規化した検証済みバッチ
 * @throws スキーマ違反またはセッションの整合性違反
 */
export function validateBatch(value: unknown, env: AnalyticsEnv, now: number): PlaySessionBatch {
  if (!validateSchema(value)) {
    throw new Error("invalid session payload");
  }

  const allowed = new Set(env.ALLOWED_GAME_IDS.split(",").map((id) => id.trim()).filter(Boolean));
  const ids = new Set<string>();

  value.installationId = value.installationId.toLowerCase();

  for (const session of value.sessions) {
    session.sessionId = session.sessionId.toLowerCase();
    const start = Date.parse(session.startedAt);
    const observed = Date.parse(session.lastObservedAt);
    const ended = session.endedAt === null ? null : Date.parse(session.endedAt);

    if (!allowed.has(session.gameId) || session.environment !== env.PLAY_ENVIRONMENT || ids.has(session.sessionId)) {
      throw new Error("unknown game, environment, or duplicate session");
    }

    ids.add(session.sessionId);

    if (!Number.isFinite(start) || !Number.isFinite(observed) || (ended !== null && !Number.isFinite(ended))) {
      throw new Error("invalid session timing");
    }

    // 時刻と終了状態の意味検証を Rust に委ねる
    if (!rust.valid_timing(start, observed, ended ?? NaN, now, session.durationSeconds, Number(session.outcome === "running"))) {
      throw new Error("invalid session timing");
    }

    if (!rust.valid_outcome(outcomes[session.outcome], session.exitCode ?? NaN,
      session.crashed === null ? -1 : Number(session.crashed), session.durationSeconds)) {
      throw new Error("invalid session outcome");
    }

    let dailyTotal = 0;
    const dates = new Set<string>();

    for (const part of session.dailyDurations) {
      // 日別配分の重複はこの層で検出し時間の上限は Rust で検証する
      const dayStart = Date.parse(`${part.date}T00:00:00+09:00`);

      if (dates.has(part.date) || !rust.valid_daily(start, observed, dayStart, part.durationSeconds)) {
        throw new Error("invalid daily duration");
      }

      dates.add(part.date);
      dailyTotal += part.durationSeconds;
    }

    if (dailyTotal !== session.durationSeconds) {
      throw new Error("daily duration total does not match session");
    }

    session.startedAt = new Date(start).toISOString();
    session.lastObservedAt = new Date(observed).toISOString();
    session.endedAt = ended === null ? null : new Date(ended).toISOString();
  }

  return value;
}

// Validate real calendar dates without accepting JavaScript date normalization
export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
