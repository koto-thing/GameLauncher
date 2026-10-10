import type { AnalyticsEnv, PlaySessionBatch } from "./types.ts";
import { detailCutoff, japanDate } from "./validation.ts";

// Hash the private installation credential without storing its token or device identifiers
export async function credentialHash(installationId: string, token: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${installationId.toLowerCase()}:${token}`));

  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Commit all snapshots in one D1 transaction while ignoring older or repeated revisions
export async function saveBatch(env: AnalyticsEnv, batch: PlaySessionBatch, now: number): Promise<Array<{ sessionId: string; revision: number }>> {
  const hash = await credentialHash(batch.installationId, batch.installationToken);
  const received = new Date(now).toISOString();
  const writeId = crypto.randomUUID();
  const owner = await env.ANALYTICS_DB.prepare("SELECT credential_hash FROM installations WHERE installation_id = ?").bind(batch.installationId).first<{ credential_hash: string }>();
  const revoked = await env.ANALYTICS_DB.prepare("SELECT 1 FROM revoked_credentials WHERE credential_hash = ? AND expires_at > ?").bind(hash, received).first();

  if (revoked || (owner && owner.credential_hash !== hash)) {
    throw new Error("credential rejected");
  }

  const statements = [env.ANALYTICS_DB.prepare(`INSERT INTO installations (installation_id, credential_hash, created_at, last_received_at)
    SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM revoked_credentials WHERE credential_hash = ? AND expires_at > ?)
    ON CONFLICT(installation_id) DO UPDATE SET last_received_at = excluded.last_received_at
    WHERE installations.credential_hash = excluded.credential_hash`).bind(batch.installationId, hash, received, received, hash, received)];

  const sessionsJson = JSON.stringify(batch.sessions.map((session) => ({ ...session, startedDate: japanDate(Date.parse(session.startedAt)) })));

  statements.push(env.ANALYTICS_DB.prepare(`INSERT INTO play_sessions
      (session_id, installation_id, revision, game_id, game_version, launcher_version, environment, started_at, started_date,
       last_observed_at, ended_at, duration_seconds, outcome, exit_code, crashed, received_at, write_id)
      SELECT json_extract(value, '$.sessionId'), ?, json_extract(value, '$.revision'),
       json_extract(value, '$.gameId'), json_extract(value, '$.gameVersion'), json_extract(value, '$.launcherVersion'),
       json_extract(value, '$.environment'), json_extract(value, '$.startedAt'), json_extract(value, '$.startedDate'),
       json_extract(value, '$.lastObservedAt'), json_extract(value, '$.endedAt'), json_extract(value, '$.durationSeconds'),
       json_extract(value, '$.outcome'), json_extract(value, '$.exitCode'), json_extract(value, '$.crashed'), ?, ?
      FROM json_each(?)
      WHERE EXISTS (SELECT 1 FROM installations WHERE installation_id = ? AND credential_hash = ?)
      ON CONFLICT(session_id) DO UPDATE SET revision = excluded.revision, last_observed_at = excluded.last_observed_at,
       ended_at = excluded.ended_at, duration_seconds = excluded.duration_seconds, outcome = excluded.outcome,
       exit_code = excluded.exit_code, crashed = excluded.crashed, received_at = excluded.received_at, write_id = excluded.write_id
      WHERE excluded.revision > play_sessions.revision`)
      .bind(batch.installationId, received, writeId, sessionsJson, batch.installationId, hash));

  statements.push(env.ANALYTICS_DB.prepare(`DELETE FROM session_daily_durations WHERE session_id IN
    (SELECT session_id FROM play_sessions WHERE write_id = ?)`).bind(writeId));

  statements.push(env.ANALYTICS_DB.prepare(`INSERT INTO session_daily_durations (session_id, date, duration_seconds)
    SELECT s.session_id, json_extract(d.value, '$.date'), json_extract(d.value, '$.durationSeconds')
    FROM json_each(?) b JOIN play_sessions s ON s.session_id = json_extract(b.value, '$.sessionId') AND s.write_id = ?
    JOIN json_each(b.value, '$.dailyDurations') d`).bind(sessionsJson, writeId));

  statements.push(env.ANALYTICS_DB.prepare("SELECT credential_hash FROM installations WHERE installation_id = ?").bind(batch.installationId));

  const result = await env.ANALYTICS_DB.batch<{ credential_hash: string }>(statements);

  if (result.at(-1)?.results[0]?.credential_hash !== hash) {
    throw new Error("credential rejected");
  }

  return batch.sessions.map(({ sessionId, revision }) => ({ sessionId, revision }));
}

// Delete identifiable data and revoke retries even if deletion races the first upload
export async function deleteInstallation(env: AnalyticsEnv, id: string, token: string, now: number): Promise<void> {
  const hash = await credentialHash(id, token);
  const owner = await env.ANALYTICS_DB.prepare("SELECT credential_hash FROM installations WHERE installation_id = ?").bind(id).first<{ credential_hash: string }>();

  if (owner && owner.credential_hash !== hash) {
    throw new Error("credential rejected");
  }

  await env.ANALYTICS_DB.batch([
    env.ANALYTICS_DB.prepare(`INSERT INTO revoked_credentials (credential_hash, expires_at)
      SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM installations WHERE installation_id = ? AND credential_hash <> ?)
      ON CONFLICT(credential_hash) DO UPDATE SET expires_at = excluded.expires_at`)
      .bind(hash, new Date(now + 90 * 86_400_000).toISOString(), id, hash),
    env.ANALYTICS_DB.prepare("DELETE FROM installations WHERE installation_id = ? AND credential_hash = ?").bind(id, hash),
  ]);
}

// Archive expired sessions as anonymous aggregates before deleting detailed records
export async function archiveDetails(env: AnalyticsEnv, now: number): Promise<void> {
  const cutoff = detailCutoff(now);

  await env.ANALYTICS_DB.batch([
    env.ANALYTICS_DB.prepare(`INSERT INTO analytics_daily
      (game_id, game_version, environment, date, launch_attempts, successful_launches, successful_duration_sum,
       running, normal, abnormal, interrupted, launch_failed, bucket0, bucket1, bucket2, bucket3, bucket4, last_received_at)
      SELECT game_id, game_version, environment, started_date, COUNT(*), SUM(outcome <> 'launch_failed'),
       SUM(CASE WHEN outcome <> 'launch_failed' THEN duration_seconds ELSE 0 END),
       0, SUM(outcome = 'normal'), SUM(outcome = 'abnormal'), SUM(outcome IN ('interrupted', 'running')), SUM(outcome = 'launch_failed'),
       SUM(outcome <> 'launch_failed' AND duration_seconds < 60),
       SUM(outcome <> 'launch_failed' AND duration_seconds >= 60 AND duration_seconds < 300),
       SUM(outcome <> 'launch_failed' AND duration_seconds >= 300 AND duration_seconds < 1800),
       SUM(outcome <> 'launch_failed' AND duration_seconds >= 1800 AND duration_seconds < 3600),
       SUM(outcome <> 'launch_failed' AND duration_seconds >= 3600), MAX(received_at)
      FROM play_sessions WHERE started_date < ? GROUP BY game_id, game_version, environment, started_date
      ON CONFLICT(game_id, game_version, environment, date) DO UPDATE SET
       launch_attempts = launch_attempts + excluded.launch_attempts, successful_launches = successful_launches + excluded.successful_launches,
       successful_duration_sum = successful_duration_sum + excluded.successful_duration_sum,
       normal = normal + excluded.normal, abnormal = abnormal + excluded.abnormal, interrupted = interrupted + excluded.interrupted,
       launch_failed = launch_failed + excluded.launch_failed, bucket0 = bucket0 + excluded.bucket0,
       bucket1 = bucket1 + excluded.bucket1, bucket2 = bucket2 + excluded.bucket2, bucket3 = bucket3 + excluded.bucket3,
       bucket4 = bucket4 + excluded.bucket4, last_received_at = MAX(last_received_at, excluded.last_received_at)`).bind(cutoff),
    env.ANALYTICS_DB.prepare(`INSERT INTO analytics_daily (game_id, game_version, environment, date, duration_seconds, last_received_at)
      SELECT s.game_id, s.game_version, s.environment, d.date, SUM(d.duration_seconds), MAX(s.received_at)
      FROM play_sessions s JOIN session_daily_durations d USING (session_id) WHERE s.started_date < ?
      GROUP BY s.game_id, s.game_version, s.environment, d.date
      ON CONFLICT(game_id, game_version, environment, date) DO UPDATE SET
       duration_seconds = duration_seconds + excluded.duration_seconds, last_received_at = MAX(last_received_at, excluded.last_received_at)`).bind(cutoff),
    env.ANALYTICS_DB.prepare("DELETE FROM play_sessions WHERE started_date < ?").bind(cutoff),
    env.ANALYTICS_DB.prepare(`DELETE FROM installations WHERE last_received_at < ? AND
      NOT EXISTS (SELECT 1 FROM play_sessions WHERE play_sessions.installation_id = installations.installation_id)`)
      .bind(new Date(Date.parse(`${cutoff}T00:00:00+09:00`)).toISOString()),
    env.ANALYTICS_DB.prepare("DELETE FROM revoked_credentials WHERE expires_at <= ?").bind(new Date(now).toISOString()),
  ]);
}
