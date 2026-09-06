-- 既存control-plane DBへMusic専用テーブルのみ追加する。
PRAGMA foreign_keys = ON;
CREATE TABLE music_accounts (id TEXT PRIMARY KEY, login TEXT NOT NULL, admin INTEGER NOT NULL DEFAULT 0 CHECK(admin IN (0,1)));
CREATE TABLE music_games (id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1, draft TEXT NOT NULL CHECK(json_valid(draft)), published TEXT CHECK(published IS NULL OR json_valid(published)), suspended INTEGER NOT NULL DEFAULT 0 CHECK(suspended IN (0,1)), actor TEXT NOT NULL REFERENCES music_accounts(id), action TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE music_memberships (game_id TEXT NOT NULL REFERENCES music_games(id), account_id TEXT NOT NULL REFERENCES music_accounts(id), PRIMARY KEY(game_id, account_id));
CREATE INDEX music_memberships_account ON music_memberships(account_id, game_id);
CREATE TABLE music_tracks (id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES music_games(id), version INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL CHECK(position > 0), published_position INTEGER, draft TEXT NOT NULL CHECK(json_valid(draft)), published TEXT CHECK(published IS NULL OR json_valid(published)), actor TEXT NOT NULL REFERENCES music_accounts(id), action TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX music_tracks_game_order ON music_tracks(game_id, position, id);
CREATE TABLE music_assets (id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES music_games(id), object_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK(kind IN ('audio','image')), mime TEXT NOT NULL, bytes INTEGER NOT NULL CHECK(bytes > 0), status TEXT NOT NULL CHECK(status IN ('pending','verified','failed')), duration_seconds REAL, sample_rate_hz INTEGER, channels INTEGER, width_pixels INTEGER, height_pixels INTEGER, created_at INTEGER NOT NULL);
CREATE INDEX music_assets_game_status ON music_assets(game_id, status);
CREATE TABLE music_rate_limits (key TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL);
CREATE TABLE music_advertisement (id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)), image_asset_id TEXT REFERENCES music_assets(id), href TEXT NOT NULL DEFAULT '', alt TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1);
INSERT INTO music_advertisement(id) VALUES(1);
CREATE TABLE music_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL REFERENCES music_accounts(id), action TEXT NOT NULL, target TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX music_audit_time ON music_audit_log(at DESC);
-- 履歴を変更と同一トランザクションに含め、競合時の偽履歴を防ぐ。
CREATE TRIGGER music_game_created AFTER INSERT ON music_games BEGIN INSERT INTO music_audit_log(actor,action,target,at) VALUES(NEW.actor,NEW.action,NEW.id,NEW.updated_at); END;
CREATE TRIGGER music_game_changed AFTER UPDATE ON music_games BEGIN INSERT INTO music_audit_log(actor,action,target,at) VALUES(NEW.actor,NEW.action,NEW.id,NEW.updated_at); END;
CREATE TRIGGER music_track_created AFTER INSERT ON music_tracks BEGIN INSERT INTO music_audit_log(actor,action,target,at) VALUES(NEW.actor,NEW.action,NEW.id,NEW.updated_at); END;
CREATE TRIGGER music_track_changed AFTER UPDATE ON music_tracks BEGIN INSERT INTO music_audit_log(actor,action,target,at) VALUES(NEW.actor,NEW.action,NEW.id,NEW.updated_at); END;

-- 曲変更を作品版へ反映し、複数曲snapshotを途中状態で固定させない。
CREATE TRIGGER music_track_revision_insert AFTER INSERT ON music_tracks BEGIN UPDATE music_games SET version=version+1 WHERE id=NEW.game_id; END;
CREATE TRIGGER music_track_revision_update AFTER UPDATE ON music_tracks BEGIN UPDATE music_games SET version=version+1 WHERE id=NEW.game_id; END;
CREATE TABLE music_publications (id TEXT PRIMARY KEY, scope TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('prepared','sending','applied','failed','unknown')), expected_revision INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), digest TEXT NOT NULL, mutation TEXT NOT NULL CHECK(json_valid(mutation)), actor TEXT NOT NULL REFERENCES music_accounts(id), receipt TEXT, error TEXT, created_at INTEGER NOT NULL);
CREATE UNIQUE INDEX music_publication_pending ON music_publications(scope) WHERE state IN ('prepared','sending','unknown');
CREATE TABLE music_delivery (scope TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE music_uploads (id TEXT PRIMARY KEY, asset_id TEXT NOT NULL UNIQUE REFERENCES music_assets(id), game_id TEXT NOT NULL REFERENCES music_games(id), digest TEXT NOT NULL, mime TEXT NOT NULL);
