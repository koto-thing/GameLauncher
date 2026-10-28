-- 受信設定はユーザー単位、購読鍵はブラウザー単位で保存する
CREATE TABLE IF NOT EXISTS lt_push_preferences (
 user_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 admission_version TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lt_push_subscriptions (
 endpoint TEXT PRIMARY KEY, user_id TEXT NOT NULL, subscription TEXT NOT NULL,
 signature TEXT NOT NULL DEFAULT '', lease_until INTEGER NOT NULL DEFAULT 0,
 last_sent_at INTEGER, last_error INTEGER
);
CREATE INDEX IF NOT EXISTS lt_push_user ON lt_push_subscriptions(user_id);
CREATE TABLE IF NOT EXISTS lt_push_status (
 id INTEGER PRIMARY KEY CHECK(id=1), checked_at INTEGER, outcome TEXT NOT NULL
);
INSERT OR IGNORE INTO lt_push_status(id,outcome) VALUES(1,'never');
