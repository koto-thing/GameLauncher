CREATE TABLE installations (
    installation_id TEXT PRIMARY KEY,
    credential_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_received_at TEXT NOT NULL
);

-- Retain only a credential digest temporarily to prevent retries after deletion
CREATE TABLE revoked_credentials (
    credential_hash TEXT PRIMARY KEY,
    expires_at TEXT NOT NULL
);

CREATE TABLE play_sessions (
    session_id TEXT PRIMARY KEY,
    installation_id TEXT NOT NULL REFERENCES installations(installation_id) ON DELETE CASCADE,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    game_id TEXT NOT NULL,
    game_version TEXT NOT NULL,
    launcher_version TEXT NOT NULL,
    environment TEXT NOT NULL CHECK (environment IN ('staging', 'production')),
    started_at TEXT NOT NULL,
    started_date TEXT NOT NULL,
    last_observed_at TEXT NOT NULL,
    ended_at TEXT,
    duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0),
    outcome TEXT NOT NULL CHECK (outcome IN ('running', 'normal', 'abnormal', 'interrupted', 'launch_failed')),
    exit_code INTEGER,
    crashed INTEGER,
    received_at TEXT NOT NULL,
    write_id TEXT NOT NULL
);

CREATE INDEX play_sessions_period ON play_sessions(environment, started_date, game_id, game_version);

CREATE INDEX play_sessions_device ON play_sessions(installation_id, game_id, environment, started_date);

-- Reject conflicting ownership and mutations even when concurrent requests race
CREATE TRIGGER play_session_conflict BEFORE INSERT ON play_sessions
WHEN EXISTS (
    SELECT 1 FROM play_sessions old WHERE old.session_id = NEW.session_id AND (
        old.installation_id <> NEW.installation_id OR old.game_id <> NEW.game_id OR
        old.game_version <> NEW.game_version OR old.launcher_version <> NEW.launcher_version OR
        old.environment <> NEW.environment OR old.started_at <> NEW.started_at OR
        (NEW.revision > old.revision AND (
            NEW.duration_seconds < old.duration_seconds OR NEW.last_observed_at < old.last_observed_at OR
            (old.outcome <> 'running' AND (
                NEW.outcome <> old.outcome OR NEW.duration_seconds <> old.duration_seconds OR
                NEW.last_observed_at <> old.last_observed_at OR NEW.ended_at IS NOT old.ended_at OR
                NEW.exit_code IS NOT old.exit_code OR NEW.crashed IS NOT old.crashed
            ))
        ))
    )
)
BEGIN
    SELECT RAISE(ABORT, 'session conflict');
END;

CREATE TABLE session_daily_durations (
    session_id TEXT NOT NULL REFERENCES play_sessions(session_id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0 AND duration_seconds <= 86400),
    PRIMARY KEY (session_id, date)
);

-- Anonymous aggregates have no session or installation identifiers
CREATE TABLE analytics_daily (
    game_id TEXT NOT NULL,
    game_version TEXT NOT NULL,
    environment TEXT NOT NULL,
    date TEXT NOT NULL,
    launch_attempts INTEGER NOT NULL DEFAULT 0,
    successful_launches INTEGER NOT NULL DEFAULT 0,
    successful_duration_sum INTEGER NOT NULL DEFAULT 0,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    running INTEGER NOT NULL DEFAULT 0,
    normal INTEGER NOT NULL DEFAULT 0,
    abnormal INTEGER NOT NULL DEFAULT 0,
    interrupted INTEGER NOT NULL DEFAULT 0,
    launch_failed INTEGER NOT NULL DEFAULT 0,
    bucket0 INTEGER NOT NULL DEFAULT 0,
    bucket1 INTEGER NOT NULL DEFAULT 0,
    bucket2 INTEGER NOT NULL DEFAULT 0,
    bucket3 INTEGER NOT NULL DEFAULT 0,
    bucket4 INTEGER NOT NULL DEFAULT 0,
    last_received_at TEXT NOT NULL,
    PRIMARY KEY (game_id, game_version, environment, date)
);
