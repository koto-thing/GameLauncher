export type PlayEnvironment = "staging" | "production";

export type PlayOutcome = "running" | "normal" | "abnormal" | "interrupted" | "launch_failed";

export interface PlaySession {
  sessionId: string;
  revision: number;
  gameId: string;
  gameVersion: string;
  launcherVersion: string;
  environment: PlayEnvironment;
  startedAt: string;
  lastObservedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  outcome: PlayOutcome;
  exitCode: number | null;
  crashed: boolean | null;
  dailyDurations: Array<{ date: string; durationSeconds: number }>;
}

export interface PlaySessionBatch {
  schemaVersion: 1;
  installationId: string;
  installationToken: string;
  sessions: PlaySession[];
}

export interface RetentionMetric {
  eligibleDevices: number | null;
  returnedDevices: number | null;
  rate: number | null;
}

export interface AnalyticsGame {
  gameId: string;
  gameVersion: string | null;
  versions: string[];
  launchAttempts: number;
  successfulLaunches: number;
  uniqueDevices: number | null;
  totalDurationSeconds: number;
  averageDurationSeconds: number;
  medianDurationSeconds: number | null;
  counts: Record<PlayOutcome, number>;
  durationHistogram: Array<{ label: string; minSeconds: number; maxSeconds: number | null; count: number }>;
  daily: Array<{ date: string; launchAttempts: number; successfulLaunches: number; uniqueDevices: number | null; durationSeconds: number }>;
  retention: { nextDay: RetentionMetric; day7: RetentionMetric };
  detailAvailable: boolean;
}

export interface AnalyticsReport {
  schemaVersion: 1;
  period: { from: string; to: string; timeZone: "Asia/Tokyo"; environment: PlayEnvironment };
  lastReceivedAt: string | null;
  games: AnalyticsGame[];
}

export interface AnalyticsEnv {
  ANALYTICS_DB: D1Database;
  INGEST_RATE_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
  ALLOWED_GAME_IDS: string;
  ANALYTICS_READ_TOKEN: string;
  PLAY_ENVIRONMENT: PlayEnvironment;
}
