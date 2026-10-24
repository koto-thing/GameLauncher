// 差分テスト専用の移行前実装 本番からは参照しない
import type { ValidateFunction } from "ajv";
import { validatePlaySessions } from "../../src/generated/play-sessions.js";
import type { AnalyticsEnv, PlaySessionBatch } from "../../src/types.ts";

const validateSchema = validatePlaySessions as ValidateFunction<PlaySessionBatch>;

export const DAY_MS = 86_400_000;

/**
 * 移行前の方法で日本時間の日付を返す
 * @param instant Unix ミリ秒
 * @returns 日本時間の暦日
 */
export function japanDate(instant: number): string {
  return new Date(instant + 9 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * 移行前の方法で詳細保持期間の開始日を返す
 * @param now 検証時刻の Unix ミリ秒
 * @returns 現在日を含む九十日間の開始日
 */
export function detailCutoff(now: number): string {
  return japanDate(now - 89 * DAY_MS);
}

/**
 * 差分テストの基準として移行前の検証と正規化を実行する
 * @param value 受信 JSON
 * @param env 許可ゲームと実行環境
 * @param now 検証時刻の Unix ミリ秒
 * @returns 正規化したバッチ
 * @throws 移行前と同じスキーマまたは意味検証の違反
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

    if (japanDate(start) < detailCutoff(now) || start > now + 300_000 || observed < start || observed > now + 300_000 ||
        session.durationSeconds > Math.floor((observed - start) / 1000) + 2 ||
        (session.outcome === "running" ? ended !== null : ended === null || ended < start || ended > observed) ||
        (ended !== null && observed !== ended)) {
      throw new Error("invalid session timing");
    }

    if ((session.outcome === "normal" && (session.exitCode !== 0 || session.crashed !== false)) ||
        (session.outcome === "abnormal" && (session.crashed === null || (!session.crashed && (session.exitCode === null || session.exitCode === 0)))) ||
        (["running", "interrupted", "launch_failed"].includes(session.outcome) && (session.exitCode !== null || session.crashed !== null)) ||
        (session.outcome === "launch_failed" && session.durationSeconds !== 0)) {
      throw new Error("invalid session outcome");
    }

    let dailyTotal = 0;
    const dates = new Set<string>();

    for (const part of session.dailyDurations) {
      const dayStart = Date.parse(`${part.date}T00:00:00+09:00`);
      const availableSeconds = Math.ceil(Math.max(0, Math.min(observed, dayStart + DAY_MS) - Math.max(start, dayStart)) / 1000);

      if (dates.has(part.date) || part.date < japanDate(start) || part.date > japanDate(observed) || part.durationSeconds > availableSeconds + 1) {
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

/**
 * 移行前の方法で実在する日付を確認する
 * @param value ISO 暦日文字列
 * @returns 正規化で日付が変わらなければ true
 */
export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
