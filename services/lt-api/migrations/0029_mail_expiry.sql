-- 短縮だけを許し、過去のjobや確認URLを再び有効にしない
CREATE TRIGGER lt_mail_expiry AFTER UPDATE OF expires ON lt_outbox WHEN NEW.expires IS NOT NULL
BEGIN UPDATE lt_mail_jobs SET expires=MIN(expires,CAST(NEW.expires/1000 AS INTEGER)) WHERE id='application:'||NEW.id; END;
CREATE TRIGGER lt_login_mail_expiry AFTER UPDATE OF expires ON lt_login_outbox
BEGIN UPDATE lt_mail_jobs SET expires=MIN(expires,CAST(NEW.expires/1000 AS INTEGER)) WHERE id='authentication:'||NEW.id; END;
CREATE TRIGGER lt_login_token_expiry AFTER UPDATE OF expires,session_hash ON lt_auth_tokens
BEGIN
 UPDATE lt_login_outbox SET expires=MIN(expires,NEW.expires,CASE WHEN NEW.session_hash IS NOT NULL THEN COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000) ELSE expires END) WHERE token_hash=NEW.hash;
 UPDATE lt_login_outbox SET action_url='' WHERE token_hash=NEW.hash AND expires<=COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000);
 UPDATE lt_mail_jobs SET envelope='{}',state='expired',lease_until=NULL WHERE id IN(SELECT 'authentication:'||id FROM lt_login_outbox WHERE token_hash=NEW.hash AND expires<=COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000));
END;
CREATE TRIGGER lt_mail_delete AFTER DELETE ON lt_outbox BEGIN DELETE FROM lt_mail_jobs WHERE id='application:'||OLD.id; END;
CREATE TRIGGER lt_login_mail_delete AFTER DELETE ON lt_login_outbox BEGIN DELETE FROM lt_mail_jobs WHERE id='authentication:'||OLD.id; END;
