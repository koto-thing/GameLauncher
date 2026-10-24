import { validate_batch } from "./rust-validation.ts";
import type { ValidateFunction } from "ajv";
import { validatePlaySessions } from "./generated/play-sessions.js";
import type { AnalyticsEnv, PlaySessionBatch } from "./types.ts";

const validateSchema = validatePlaySessions as ValidateFunction<PlaySessionBatch>;

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
  try {
    return JSON.parse(validate_batch(JSON.stringify(value), env.ALLOWED_GAME_IDS, env.PLAY_ENVIRONMENT, now)) as PlaySessionBatch;
  } catch (error) {
    // wasm-bindgen が送出する既存の意味検証メッセージを HTTP 層へ引き継ぐ
    throw new Error(typeof error === "string" ? error : "analytics unavailable");
  }
}

// Validate real calendar dates without accepting JavaScript date normalization
export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
