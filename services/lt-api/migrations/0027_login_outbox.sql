-- 認証通知は申請に所属させず、確認tokenに明示的に紐付ける
CREATE TABLE lt_login_outbox(
 id TEXT PRIMARY KEY,
 token_hash TEXT NOT NULL REFERENCES lt_auth_tokens(hash),
 recipient TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind='emailConfirmation'),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sent')),
 action_url TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 expires INTEGER NOT NULL
);
CREATE INDEX lt_login_due ON lt_login_outbox(state,expires);
CREATE INDEX lt_login_expiry ON lt_login_outbox(expires);
ALTER TABLE lt_outbox ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
-- 作成時刻不明の既存通知を新しい送信待ちとして復活させない
UPDATE lt_outbox SET expires=MIN(COALESCE(expires,COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000)),COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000)) WHERE created_at=0 AND state='pending';
CREATE TRIGGER lt_outbox_created AFTER INSERT ON lt_outbox WHEN NEW.created_at=0
BEGIN UPDATE lt_outbox SET created_at=CAST(COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000) AS INTEGER) WHERE id=NEW.id; END;
