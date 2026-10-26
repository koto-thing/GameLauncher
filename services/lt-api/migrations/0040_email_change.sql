-- メール変更は対象申請と開催回に所属する私有状態として保持する
ALTER TABLE lt_applications ADD COLUMN email_fence TEXT;
CREATE TABLE lt_email_changes(
 id TEXT PRIMARY KEY,application_id TEXT NOT NULL REFERENCES lt_applications(id),event_id TEXT NOT NULL REFERENCES lt_events(id),
 version INTEGER NOT NULL DEFAULT 1,state TEXT NOT NULL CHECK(state IN('investigating','verificationPending','verified','confirmed','cancelled')),
 current INTEGER NOT NULL CHECK(current IN(0,1)),old_email TEXT NOT NULL,new_email TEXT NOT NULL,
 actor TEXT NOT NULL,identity_method TEXT NOT NULL CHECK(length(trim(identity_method))>0 AND length(identity_method)<=80),identity_result TEXT NOT NULL CHECK(identity_result='confirmed'),checked_at TEXT NOT NULL,
 token_hash TEXT,verification_expires INTEGER,verified_at TEXT,expires INTEGER
);
CREATE UNIQUE INDEX lt_email_change_current ON lt_email_changes(application_id) WHERE current=1;
CREATE INDEX lt_email_change_expiry ON lt_email_changes(expires);
CREATE TABLE lt_email_change_tokens(hash TEXT PRIMARY KEY,request_id TEXT NOT NULL REFERENCES lt_email_changes(id),purpose TEXT NOT NULL CHECK(purpose='email_change'),expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0 CHECK(used IN(0,1)));
CREATE TABLE lt_email_change_payloads(outbox_id TEXT PRIMARY KEY REFERENCES lt_outbox(id),token_hash TEXT NOT NULL REFERENCES lt_email_change_tokens(hash),action_url TEXT NOT NULL);
CREATE TABLE lt_email_change_operations(actor TEXT NOT NULL,operation_id TEXT NOT NULL,payload_hash TEXT NOT NULL,application_id TEXT NOT NULL,request_id TEXT NOT NULL,expires INTEGER,PRIMARY KEY(actor,operation_id));
CREATE TABLE lt_email_change_audit(id TEXT PRIMARY KEY,request_id TEXT NOT NULL,application_id TEXT NOT NULL,event_id TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,occurred_at TEXT NOT NULL,expires INTEGER);
-- 確認用payloadも既存の単一mail dispatcherを使う。runtime自体は変更しない
DROP VIEW lt_mail_outbox;
CREATE VIEW lt_mail_outbox AS SELECT 'application:'||o.id AS id,o.recipient,o.kind,o.state,o.expires,o.created_at,COALESCE(p.action_url,'') AS action_url FROM lt_outbox o LEFT JOIN lt_email_change_payloads p ON p.outbox_id=o.id
 UNION ALL SELECT 'authentication:'||id,recipient,kind,state,expires,created_at,action_url FROM lt_login_outbox;
CREATE TRIGGER lt_change_token_used AFTER UPDATE OF used ON lt_email_change_tokens WHEN OLD.used=0 AND NEW.used=1
BEGIN
 UPDATE lt_email_changes SET state='verified',version=version+1,verified_at=strftime('%Y-%m-%dT%H:%M:%fZ',COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000)/1000.0,'unixepoch') WHERE id=NEW.request_id AND current=1 AND token_hash=NEW.hash AND state='verificationPending';
END;
CREATE TRIGGER lt_change_token_expiry AFTER UPDATE OF expires,used ON lt_email_change_tokens
BEGIN
 UPDATE lt_outbox SET expires=MIN(expires,NEW.expires,CASE WHEN NEW.used=1 THEN COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000) ELSE expires END) WHERE id IN(SELECT outbox_id FROM lt_email_change_payloads WHERE token_hash=NEW.hash);
 UPDATE lt_email_change_payloads SET action_url='' WHERE token_hash=NEW.hash AND (NEW.used=1 OR NEW.expires<=COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000));
 UPDATE lt_mail_jobs SET envelope='{}',state='expired',lease_until=NULL WHERE id IN(SELECT 'application:'||outbox_id FROM lt_email_change_payloads WHERE token_hash=NEW.hash AND (NEW.used=1 OR NEW.expires<=COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000)));
END;
CREATE TRIGGER lt_change_link_no_extension AFTER UPDATE OF expires ON lt_outbox WHEN OLD.kind='emailConfirmation' AND OLD.expires IS NOT NULL AND NEW.expires>OLD.expires
BEGIN UPDATE lt_outbox SET expires=OLD.expires WHERE id=NEW.id; END;
CREATE TRIGGER lt_change_retention AFTER UPDATE OF private_expires ON lt_events WHEN NEW.private_expires IS NOT NULL
BEGIN
 UPDATE lt_email_changes SET expires=MIN(COALESCE(expires,NEW.private_expires),NEW.private_expires) WHERE event_id=NEW.id;
 UPDATE lt_email_change_operations SET expires=NEW.private_expires WHERE application_id IN(SELECT id FROM lt_applications WHERE event_id=NEW.id);
 UPDATE lt_email_change_audit SET expires=NEW.private_expires WHERE event_id=NEW.id;
 UPDATE lt_email_change_tokens SET expires=MIN(expires,NEW.private_expires) WHERE request_id IN(SELECT id FROM lt_email_changes WHERE event_id=NEW.id);
END;
CREATE TRIGGER lt_change_event_cancel AFTER UPDATE OF state ON lt_events WHEN NEW.state='cancelled'
BEGIN
 UPDATE lt_email_changes SET state='cancelled',version=version+1 WHERE event_id=NEW.id AND current=1 AND state!='confirmed' AND state!='cancelled';
 UPDATE lt_email_change_tokens SET expires=MIN(expires,COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000)) WHERE request_id IN(SELECT id FROM lt_email_changes WHERE event_id=NEW.id) AND used=0;
END;
