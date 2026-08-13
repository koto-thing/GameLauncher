import { env } from "cloudflare:workers";

let initialized: Promise<void> | undefined;

const statements = [
  `CREATE TABLE IF NOT EXISTS users (
    github_user_id TEXT PRIMARY KEY,
    login_snapshot TEXT NOT NULL,
    avatar_url TEXT NOT NULL DEFAULT '',
    is_admin INTEGER NOT NULL DEFAULT 0,
    last_verified_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS policy_grants (
    github_user_id TEXT NOT NULL,
    grant_type TEXT NOT NULL CHECK (grant_type IN ('requester','approver','production_requester')),
    granted_by_github_user_id TEXT NOT NULL,
    granted_at TEXT NOT NULL,
    revoked_at TEXT,
    PRIMARY KEY (github_user_id, grant_type)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_policy_grants_active
    ON policy_grants(grant_type, revoked_at)`,
  `CREATE TABLE IF NOT EXISTS artifacts (
    artifact_id TEXT PRIMARY KEY,
    intake_object_key TEXT NOT NULL UNIQUE,
    size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5368709120),
    file_count INTEGER NOT NULL CHECK (file_count > 0 AND file_count <= 50000),
    claimed_sha256 TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status = 'sealed'),
    sealed_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS intake_uploads (
    artifact_id TEXT PRIMARY KEY,
    intake_object_key TEXT NOT NULL UNIQUE,
    multipart_upload_id TEXT NOT NULL,
    requester_github_user_id TEXT NOT NULL REFERENCES users(github_user_id),
    size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5368709120),
    file_count INTEGER NOT NULL CHECK (file_count > 0 AND file_count <= 50000),
    claimed_sha256 TEXT NOT NULL,
    game_id TEXT NOT NULL,
    version TEXT NOT NULL,
    part_size INTEGER NOT NULL,
    part_count INTEGER NOT NULL CHECK (part_count > 0 AND part_count <= 80),
    state TEXT NOT NULL CHECK (state IN ('uploading','sealing','sealed','cancelled')),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_intake_uploads_requester_state
    ON intake_uploads(requester_github_user_id, state)`,
  `CREATE INDEX IF NOT EXISTS idx_intake_uploads_expires ON intake_uploads(expires_at)`,
  `CREATE TABLE IF NOT EXISTS intake_upload_parts (
    artifact_id TEXT NOT NULL REFERENCES intake_uploads(artifact_id),
    part_number INTEGER NOT NULL,
    etag TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (artifact_id, part_number)
  )`,
  `CREATE TABLE IF NOT EXISTS deployment_requests (
    request_id TEXT PRIMARY KEY,
    environment TEXT NOT NULL CHECK (environment IN ('staging','production')),
    artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id),
    artifact_sha256 TEXT NOT NULL,
    game_id TEXT NOT NULL,
    version TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    metadata_sha256 TEXT NOT NULL,
    requester_github_user_id TEXT NOT NULL REFERENCES users(github_user_id),
    source_staging_request_id TEXT,
    state TEXT NOT NULL,
    created_at TEXT NOT NULL,
    submitted_at TEXT,
    production_eligible_until TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_deployment_requests_created
    ON deployment_requests(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_deployment_requests_state
    ON deployment_requests(state)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_deployment_requests_environment_game_version
    ON deployment_requests(environment, game_id, version)`,
  `CREATE TABLE IF NOT EXISTS request_approvers (
    request_id TEXT NOT NULL REFERENCES deployment_requests(request_id),
    approver_github_user_id TEXT NOT NULL REFERENCES users(github_user_id),
    designated_by_github_user_id TEXT NOT NULL,
    designated_at TEXT NOT NULL,
    PRIMARY KEY (request_id, approver_github_user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS approval_decisions (
    request_id TEXT NOT NULL REFERENCES deployment_requests(request_id),
    approver_github_user_id TEXT NOT NULL REFERENCES users(github_user_id),
    decision TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
    reason TEXT NOT NULL DEFAULT '',
    decided_at TEXT NOT NULL,
    PRIMARY KEY (request_id, approver_github_user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS execution_attempts (
    attempt_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES deployment_requests(request_id),
    attempt_number INTEGER NOT NULL,
    github_run_id TEXT,
    github_run_attempt INTEGER,
    workflow_commit_sha TEXT,
    stage TEXT NOT NULL,
    result TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_attempts_request_number
    ON execution_attempts(request_id, attempt_number)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_attempts_github_run
    ON execution_attempts(github_run_id, github_run_attempt)`,
  `CREATE TABLE IF NOT EXISTS audit_events (
    event_id TEXT PRIMARY KEY,
    request_id TEXT,
    sequence INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    actor_github_user_id TEXT,
    actor_login_snapshot TEXT,
    occurred_at TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    previous_event_hash TEXT NOT NULL,
    event_hash TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_events_request_sequence
    ON audit_events(request_id, sequence)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_events_scope_sequence
    ON audit_events(COALESCE(request_id, '__global__'), sequence)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_events_occurred
    ON audit_events(occurred_at)`,
];

export function getD1(): D1Database {
  if (!env.DB) {
    throw new Error("D1 binding DB is unavailable");
  }
  return env.DB;
}

export async function ensureSchema(): Promise<void> {
  initialized ??= (async () => {
    const db = getD1();
    await db.batch(statements.map((statement) => db.prepare(statement)));
    await db.prepare("PRAGMA optimize").run();
  })();
  return initialized;
}
