-- 削除された曲の印刷物を別の曲へ誘導しないため、予約は永久に残す。
-- track_idには意図的に外部キーを設定しない。削除・更新をDBでも禁止する。
CREATE TABLE music_command_codes (version INTEGER NOT NULL CHECK(version = 1), code_id INTEGER NOT NULL CHECK(code_id BETWEEN 0 AND 16777215), track_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(version, code_id), UNIQUE(version, track_id));
CREATE TRIGGER music_command_codes_no_delete BEFORE DELETE ON music_command_codes BEGIN SELECT RAISE(ABORT, 'Command reservations are permanent'); END;
CREATE TRIGGER music_command_codes_no_update BEFORE UPDATE ON music_command_codes BEGIN SELECT RAISE(ABORT, 'Command reservations are immutable'); END;
