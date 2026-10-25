-- API担当が番号を決めて適用する提案。現行migrationは変更しない
CREATE TABLE lt_mail_mode(id INTEGER PRIMARY KEY CHECK(id=1), mode TEXT NOT NULL CHECK(mode IN ('disabled','fake','http')));
INSERT INTO lt_mail_mode VALUES(1,'disabled');
CREATE TABLE lt_mail_jobs(
 id TEXT PRIMARY KEY REFERENCES lt_outbox(id),
 envelope TEXT NOT NULL CHECK(json_valid(envelope)),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','leased','sent','failed','uncertain','expired')),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_at INTEGER NOT NULL DEFAULT 0,
 lease_until INTEGER,
 fence TEXT,
 expires INTEGER NOT NULL
);
-- envelopeとrecipient/linkを含むため保持期限対象。未確定保持期限でも24時間以内の配達期限をAPIが指定する
CREATE INDEX lt_mail_due ON lt_mail_jobs(state,next_at,expires);

-- 開催終了等で固定された期限を既存のjobへ短縮継承する
CREATE TRIGGER lt_mail_expiry AFTER UPDATE OF expires ON lt_outbox
WHEN NEW.expires IS NOT NULL
BEGIN UPDATE lt_mail_jobs SET expires=MIN(expires,CAST(NEW.expires/1000 AS INTEGER)) WHERE id=NEW.id; END;
CREATE TRIGGER lt_mail_delete AFTER DELETE ON lt_outbox
BEGIN DELETE FROM lt_mail_jobs WHERE id=OLD.id; END;
