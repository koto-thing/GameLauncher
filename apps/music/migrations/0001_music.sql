-- 公開スナップショットを下書きから分離する。Music専用DB以外へ適用しない。
PRAGMA foreign_keys = ON;
CREATE TABLE accounts (id TEXT PRIMARY KEY, login TEXT NOT NULL, admin INTEGER NOT NULL DEFAULT 0 CHECK(admin IN (0,1)));
CREATE TABLE games (id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1, draft TEXT NOT NULL CHECK(json_valid(draft)), published TEXT CHECK(published IS NULL OR json_valid(published)), suspended INTEGER NOT NULL DEFAULT 0 CHECK(suspended IN (0,1)), actor TEXT NOT NULL REFERENCES accounts(id), action TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE memberships (game_id TEXT NOT NULL REFERENCES games(id), account_id TEXT NOT NULL REFERENCES accounts(id), PRIMARY KEY(game_id, account_id));
CREATE INDEX memberships_account ON memberships(account_id, game_id);
CREATE TABLE tracks (id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES games(id), version INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL CHECK(position > 0), published_position INTEGER, draft TEXT NOT NULL CHECK(json_valid(draft)), published TEXT CHECK(published IS NULL OR json_valid(published)), actor TEXT NOT NULL REFERENCES accounts(id), action TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX tracks_game_order ON tracks(game_id, position, id);
CREATE TABLE assets (id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES games(id), object_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK(kind IN ('audio','image')), mime TEXT NOT NULL, bytes INTEGER NOT NULL CHECK(bytes > 0), status TEXT NOT NULL CHECK(status IN ('pending','verified','failed')), duration_seconds REAL, sample_rate_hz INTEGER, channels INTEGER, width_pixels INTEGER, height_pixels INTEGER, created_at INTEGER NOT NULL);
CREATE INDEX assets_game_status ON assets(game_id, status);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE oauth_flows (state_hash TEXT PRIMARY KEY, verifier TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL);
CREATE TABLE advertisement (id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)), image_asset_id TEXT REFERENCES assets(id), href TEXT NOT NULL DEFAULT '', alt TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1);
INSERT INTO advertisement(id) VALUES(1);
CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL REFERENCES accounts(id), action TEXT NOT NULL, target TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX audit_time ON audit_log(at DESC);
-- 履歴を変更と同一トランザクションに含め、競合時の偽履歴を防ぐ。
CREATE TRIGGER game_created AFTER INSERT ON games BEGIN INSERT INTO audit_log(actor,action,target,at) VALUES(NEW.actor,NEW.action,NEW.id,NEW.updated_at); END;
CREATE TRIGGER game_changed AFTER UPDATE ON games BEGIN INSERT INTO audit_log(actor,action,target,at) VALUES(NEW.actor,NEW.action,NEW.id,NEW.updated_at); END;
CREATE TRIGGER track_created AFTER INSERT ON tracks BEGIN INSERT INTO audit_log(actor,action,target,at) VALUES(NEW.actor,NEW.action,NEW.id,NEW.updated_at); END;
CREATE TRIGGER track_changed AFTER UPDATE ON tracks BEGIN INSERT INTO audit_log(actor,action,target,at) VALUES(NEW.actor,NEW.action,NEW.id,NEW.updated_at); END;
