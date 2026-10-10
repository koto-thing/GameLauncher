import type { AnalyticsEnv, AnalyticsGame, AnalyticsReport, RetentionMetric } from "./types.ts";
import { DAY_MS, detailCutoff, japanDate, validDate } from "./validation.ts";

const buckets = [
  { label: "1分未満", minSeconds: 0, maxSeconds: 60 },
  { label: "1〜5分", minSeconds: 60, maxSeconds: 300 },
  { label: "5〜30分", minSeconds: 300, maxSeconds: 1800 },
  { label: "30〜60分", minSeconds: 1800, maxSeconds: 3600 },
  { label: "60分以上", minSeconds: 3600, maxSeconds: null },
];

interface FactRow {
  game_id: string;
  game_version: string;
  date: string;
  launch_attempts: number;
  successful_launches: number;
  successful_duration_sum: number;
  duration_seconds: number;
  running: number;
  normal: number;
  abnormal: number;
  interrupted: number;
  launch_failed: number;
  bucket0: number;
  bucket1: number;
  bucket2: number;
  bucket3: number;
  bucket4: number;
  last_received_at: string;
  detail_missing: number;
}

interface DetailRow { game_id: string; date: string | null; devices: number; median: number | null }

interface CohortRow { game_id: string; day: number; eligible: number; returned: number }

// Read anonymous historical aggregates together with current detailed records in one snapshot
export async function readAnalytics(env: AnalyticsEnv, url: URL, now: number): Promise<AnalyticsReport> {
  const from = url.searchParams.get("from") ?? japanDate(now - 29 * DAY_MS);
  const to = url.searchParams.get("to") ?? japanDate(now);
  const environment = url.searchParams.get("environment") ?? "production";
  const gameId = url.searchParams.get("gameId") || null;
  const gameVersion = url.searchParams.get("gameVersion") || null;
  const days = Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;

  if (!validDate(from) || !validDate(to) || days < 1 || days > 366 || to > japanDate(now) ||
      !["production", "staging"].includes(environment) || environment !== env.PLAY_ENVIRONMENT ||
      (gameId !== null && !/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(gameId)) ||
      (gameVersion !== null && !/^[A-Za-z0-9.+_-]{1,64}$/.test(gameVersion))) {
    throw new Error("invalid analytics filters");
  }

  for (const key of url.searchParams.keys()) {
    if (!["from", "to", "environment", "gameId", "gameVersion"].includes(key) || url.searchParams.getAll(key).length !== 1) {
      throw new Error("invalid analytics filters");
    }
  }

  const dimensions = "environment = ? AND (? IS NULL OR game_id = ?) AND (? IS NULL OR game_version = ?)";
  const dimensionArgs = [environment, gameId, gameId, gameVersion, gameVersion];
  const cutoff = detailCutoff(now);
  const staleBefore = new Date(now - 10 * 60_000).toISOString();
  const detailAvailable = from >= cutoff;
  const factsQuery = `WITH facts AS (
    SELECT game_id, game_version, date, launch_attempts, successful_launches, successful_duration_sum, duration_seconds,
      running, normal, abnormal, interrupted, launch_failed, bucket0, bucket1, bucket2, bucket3, bucket4, last_received_at, duration_seconds > 0 detail_missing
      FROM analytics_daily WHERE date BETWEEN ? AND ? AND ${dimensions}
    UNION ALL
    SELECT game_id, game_version, started_date, 1, outcome <> 'launch_failed',
      CASE WHEN outcome <> 'launch_failed' THEN duration_seconds ELSE 0 END, 0,
      outcome = 'running' AND last_observed_at > ?, outcome = 'normal', outcome = 'abnormal',
      outcome = 'interrupted' OR (outcome = 'running' AND last_observed_at <= ?), outcome = 'launch_failed',
      outcome <> 'launch_failed' AND duration_seconds < 60,
      outcome <> 'launch_failed' AND duration_seconds >= 60 AND duration_seconds < 300,
      outcome <> 'launch_failed' AND duration_seconds >= 300 AND duration_seconds < 1800,
      outcome <> 'launch_failed' AND duration_seconds >= 1800 AND duration_seconds < 3600,
      outcome <> 'launch_failed' AND duration_seconds >= 3600, received_at, 0
      FROM play_sessions WHERE started_date BETWEEN ? AND ? AND ${dimensions}
    UNION ALL
    SELECT s.game_id, s.game_version, d.date, 0, 0, 0, d.duration_seconds, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, s.received_at, 0
      FROM play_sessions s JOIN session_daily_durations d USING (session_id)
      WHERE d.date BETWEEN ? AND ? AND s.environment = ? AND (? IS NULL OR s.game_id = ?) AND (? IS NULL OR s.game_version = ?)
    ) SELECT game_id, game_version, date, SUM(launch_attempts) launch_attempts, SUM(successful_launches) successful_launches,
      SUM(successful_duration_sum) successful_duration_sum, SUM(duration_seconds) duration_seconds,
      SUM(running) running, SUM(normal) normal, SUM(abnormal) abnormal, SUM(interrupted) interrupted, SUM(launch_failed) launch_failed,
      SUM(bucket0) bucket0, SUM(bucket1) bucket1, SUM(bucket2) bucket2, SUM(bucket3) bucket3, SUM(bucket4) bucket4,
      MAX(last_received_at) last_received_at, MAX(detail_missing) detail_missing FROM facts GROUP BY game_id, game_version, date ORDER BY game_id, date`;
  const detailsQuery = `WITH base AS (SELECT * FROM play_sessions WHERE outcome <> 'launch_failed' AND ${dimensions}),
    filtered AS (SELECT * FROM base WHERE started_date BETWEEN ? AND ?), activity AS (
      SELECT game_id, installation_id, started_date date FROM filtered
      UNION SELECT b.game_id, b.installation_id, d.date FROM base b JOIN session_daily_durations d USING(session_id)
        WHERE d.date BETWEEN ? AND ? AND d.duration_seconds > 0
    ), ranked AS (
    SELECT game_id, duration_seconds, ROW_NUMBER() OVER (PARTITION BY game_id ORDER BY duration_seconds) position,
      COUNT(*) OVER (PARTITION BY game_id) total FROM filtered
    ), medians AS (SELECT game_id, AVG(duration_seconds) median FROM ranked
      WHERE position IN ((total + 1) / 2, (total + 2) / 2) GROUP BY game_id)
    SELECT a.game_id, NULL date, COUNT(DISTINCT a.installation_id) devices, m.median FROM activity a
      LEFT JOIN medians m USING (game_id) GROUP BY a.game_id
    UNION ALL SELECT game_id, date, COUNT(DISTINCT installation_id) devices, NULL median
      FROM activity GROUP BY game_id, date`;
  const cohortsQuery = `WITH cohorts AS (
    SELECT installation_id, game_id, MIN(started_date) first_date FROM play_sessions WHERE ${dimensions}
      AND started_date >= ? AND outcome <> 'launch_failed'
      GROUP BY installation_id, game_id
    ), horizons AS (SELECT 1 day UNION ALL SELECT 7)
    SELECT c.game_id, h.day, COUNT(*) eligible, SUM(EXISTS (
      SELECT 1 FROM play_sessions s WHERE s.installation_id = c.installation_id AND s.game_id = c.game_id
        AND s.environment = ? AND (? IS NULL OR s.game_version = ?) AND s.outcome <> 'launch_failed'
        AND (s.started_date = date(c.first_date, '+' || h.day || ' days') OR EXISTS (
          SELECT 1 FROM session_daily_durations d WHERE d.session_id = s.session_id AND d.duration_seconds > 0
            AND d.date = date(c.first_date, '+' || h.day || ' days')
        ))
    )) returned FROM cohorts c CROSS JOIN horizons h WHERE c.first_date BETWEEN ? AND ?
      AND date(c.first_date, '+' || h.day || ' days') < ? GROUP BY c.game_id, h.day`;
  const queries = [env.ANALYTICS_DB.prepare(factsQuery).bind(from, to, ...dimensionArgs, staleBefore, staleBefore, from, to, ...dimensionArgs, from, to, ...dimensionArgs)];

  if (detailAvailable) {
    queries.push(env.ANALYTICS_DB.prepare(detailsQuery).bind(...dimensionArgs, from, to, from, to));
    queries.push(env.ANALYTICS_DB.prepare(cohortsQuery).bind(...dimensionArgs, cutoff, environment, gameVersion, gameVersion, from, to, japanDate(now)));
  }

  const results = await env.ANALYTICS_DB.batch(queries);
  const facts = results[0].results as unknown as FactRow[];
  const details = detailAvailable ? results[1].results as unknown as DetailRow[] : [];
  const cohorts = detailAvailable ? results[2].results as unknown as CohortRow[] : [];
  const games = new Map<string, AnalyticsGame>();
  const durationSums = new Map<string, number>();
  let lastReceivedAt: string | null = null;

  for (const fact of facts) {
    let game = games.get(fact.game_id);

    if (!game) {
      const unavailable: RetentionMetric = { eligibleDevices: null, returnedDevices: null, rate: null };

      game = {
        gameId: fact.game_id, gameVersion, versions: [], launchAttempts: 0, successfulLaunches: 0,
        uniqueDevices: detailAvailable ? 0 : null, totalDurationSeconds: 0, averageDurationSeconds: 0,
        medianDurationSeconds: null, counts: { running: 0, normal: 0, abnormal: 0, interrupted: 0, launch_failed: 0 },
        durationHistogram: buckets.map((bucket) => ({ ...bucket, count: 0 })), daily: [],
        retention: { nextDay: { ...unavailable }, day7: { ...unavailable } }, detailAvailable,
      };

      for (let index = 0; index < days; index++) {
        game.daily.push({ date: new Date(Date.parse(`${from}T00:00:00Z`) + index * DAY_MS).toISOString().slice(0, 10),
          launchAttempts: 0, successfulLaunches: 0, uniqueDevices: detailAvailable ? 0 : null, durationSeconds: 0 });
      }

      if (detailAvailable) {
        game.retention = { nextDay: { eligibleDevices: 0, returnedDevices: 0, rate: null }, day7: { eligibleDevices: 0, returnedDevices: 0, rate: null } };
      }

      games.set(game.gameId, game);
    }

    if (!game.versions.includes(fact.game_version)) {
      game.versions.push(fact.game_version);
    }

    if (fact.detail_missing && game.detailAvailable) {
      game.detailAvailable = false;
      game.uniqueDevices = null;
      game.medianDurationSeconds = null;
      game.retention = { nextDay: { eligibleDevices: null, returnedDevices: null, rate: null }, day7: { eligibleDevices: null, returnedDevices: null, rate: null } };

      for (const daily of game.daily) daily.uniqueDevices = null;
    }

    game.launchAttempts += fact.launch_attempts;
    game.successfulLaunches += fact.successful_launches;
    game.totalDurationSeconds += fact.duration_seconds;
    durationSums.set(game.gameId, (durationSums.get(game.gameId) ?? 0) + fact.successful_duration_sum);

    for (const outcome of ["running", "normal", "abnormal", "interrupted", "launch_failed"] as const) {
      game.counts[outcome] += fact[outcome];
    }

    for (let index = 0; index < buckets.length; index++) {
      game.durationHistogram[index].count += fact[`bucket${index}` as keyof FactRow] as number;
    }

    const daily = game.daily.find((day) => day.date === fact.date)!;

    daily.launchAttempts += fact.launch_attempts;
    daily.successfulLaunches += fact.successful_launches;
    daily.durationSeconds += fact.duration_seconds;
    if (lastReceivedAt === null || fact.last_received_at > String(lastReceivedAt)) {
      lastReceivedAt = fact.last_received_at;
    }
  }

  for (const detail of details) {
    const game = games.get(detail.game_id);

    if (!game?.detailAvailable) continue;

    if (detail.date === null) {
      game.uniqueDevices = detail.devices;
      game.medianDurationSeconds = detail.median;
    } else {
      game.daily.find((day) => day.date === detail.date)!.uniqueDevices = detail.devices;
    }
  }

  for (const cohort of cohorts) {
    const game = games.get(cohort.game_id);

    if (!game?.detailAvailable) continue;

    game.retention[cohort.day === 1 ? "nextDay" : "day7"] = {
      eligibleDevices: cohort.eligible, returnedDevices: cohort.returned,
      rate: cohort.eligible > 0 ? cohort.returned / cohort.eligible : null,
    };
  }

  for (const game of games.values()) {
    game.averageDurationSeconds = game.successfulLaunches > 0 ? (durationSums.get(game.gameId) ?? 0) / game.successfulLaunches : 0;
    game.versions.sort();
  }

  return { schemaVersion: 1, period: { from, to, timeZone: "Asia/Tokyo", environment: environment as "production" | "staging" }, lastReceivedAt, games: [...games.values()] };
}
