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

// Validate structure and the relationships needed for trustworthy cumulative snapshots
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

// Validate real calendar dates without accepting JavaScript date normalization
export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
