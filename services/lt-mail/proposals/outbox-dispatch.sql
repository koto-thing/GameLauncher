-- API側でlt_login_outboxと両outboxのcreated_atを定義してから適用する
-- 配送モードは既定無効。公開HTTPから選択しない
CREATE TABLE lt_mail_mode(id INTEGER PRIMARY KEY CHECK(id=1),mode TEXT NOT NULL CHECK(mode IN ('disabled','fake','http')));
INSERT INTO lt_mail_mode VALUES(1,'disabled');
CREATE VIEW lt_mail_outbox AS
 SELECT 'application:'||id AS id,recipient,kind,state,expires,created_at,'' AS action_url FROM lt_outbox
 UNION ALL SELECT 'authentication:'||id,recipient,kind,state,expires,created_at,action_url FROM lt_login_outbox;
CREATE TABLE lt_mail_jobs(
 id TEXT PRIMARY KEY,
 envelope TEXT NOT NULL CHECK(json_valid(envelope)),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','leased','sent','failed','uncertain','expired')),
 transport TEXT CHECK(transport IN ('fake','http')),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_at INTEGER NOT NULL DEFAULT 0,
 lease_until INTEGER,
 fence TEXT,
 delivered_at INTEGER,
 expires INTEGER NOT NULL
);
CREATE INDEX lt_mail_due ON lt_mail_jobs(state,next_at,expires);
CREATE INDEX lt_mail_expiry_index ON lt_mail_jobs(expires);
CREATE UNIQUE INDEX lt_mail_attempt ON lt_mail_jobs(fence) WHERE fence IS NOT NULL;

CREATE TRIGGER lt_mail_expiry AFTER UPDATE OF expires ON lt_outbox WHEN NEW.expires IS NOT NULL
BEGIN UPDATE lt_mail_jobs SET expires=MIN(expires,CAST(NEW.expires/1000 AS INTEGER)) WHERE id='application:'||NEW.id; END;
CREATE TRIGGER lt_mail_delete AFTER DELETE ON lt_outbox BEGIN DELETE FROM lt_mail_jobs WHERE id='application:'||OLD.id; END;
