import { validate_batch } from "./rust-validation.ts";
import type { ValidateFunction } from "ajv";
import { validatePlaySessions } from "./generated/play-sessions.js";
import type { AnalyticsEnv, PlaySessionBatch } from "./types.ts";

const validateSchema = validatePlaySessions as ValidateFunction<PlaySessionBatch>;

type Normalization = Pick<PlaySessionBatch, "installationId"> & {
  sessions: Array<Pick<PlaySessionBatch["sessions"][number], "sessionId" | "startedAt" | "lastObservedAt" | "endedAt">>;
};

/**
 * Rust の返却値が正規化フィールドだけの対応するバッチであることを確認する
 * @param value JSON として復元した Rust の返却値
 * @param count 入力バッチのセッション件数
 * @returns 件数と型とキーが一致した場合は true
 */
export function isNormalization(value: unknown, count: number): value is Normalization {
  // 構造が崩れた返却値を反映する前に拒否する
  if (value === null || typeof value !== "object") return false;

  const result = value as Record<string, unknown>;

  if (Object.keys(result).length !== 2 || typeof result.installationId !== "string" ||
      !Array.isArray(result.sessions) || result.sessions.length !== count) return false;

  // ドメイン規則を重複させず各セッションの返却フィールドだけを確認する
  return result.sessions.every((session: unknown) => {
    if (session === null || typeof session !== "object") return false;

    const fields = session as Record<string, unknown>;

    return Object.keys(fields).length === 4 && typeof fields.sessionId === "string" &&
      typeof fields.startedAt === "string" && typeof fields.lastObservedAt === "string" &&
      (fields.endedAt === null || typeof fields.endedAt === "string");
  });
}

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

  // スキーマ適合後の意味検証と正規化を一度の Rust 呼出しで行う
  let normalization: unknown;

  try {
    normalization = JSON.parse(validate_batch(JSON.stringify(value), env.ALLOWED_GAME_IDS, env.PLAY_ENVIRONMENT, now));
  } catch (error) {
    // wasm-bindgen が送出する既存の意味検証メッセージを HTTP 層へ引き継ぐ
    throw new Error(typeof error === "string" ? error : "analytics unavailable");
  }

  // 欠落したセッションや余分なフィールドを保存経路へ通さない
  if (!isNormalization(normalization, value.sessions.length)) throw new Error("analytics unavailable");

  // Rust が正規化したフィールドだけを反映し日別配列の再転送を避ける
  value.installationId = normalization.installationId;

  for (let index = 0; index < value.sessions.length; index++) {
    Object.assign(value.sessions[index], normalization.sessions[index]);
  }

  return value;
}

// Validate real calendar dates without accepting JavaScript date normalization
export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
