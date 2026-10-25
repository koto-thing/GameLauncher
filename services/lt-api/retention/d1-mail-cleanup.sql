-- 認証outboxは申請候補とは独立した短期寿命。tokenより先に削除する
DELETE FROM lt_login_outbox WHERE expires<=:now_ms;
-- 正規source削除triggerで連動するが、古い孤立jobも期限到達時だけ掃除する
DELETE FROM lt_mail_jobs WHERE expires*1000<=:now_ms AND (
 (id LIKE 'authentication:%' AND NOT EXISTS(SELECT 1 FROM lt_login_outbox o WHERE 'authentication:'||o.id=lt_mail_jobs.id)) OR
 (id LIKE 'application:%' AND NOT EXISTS(SELECT 1 FROM lt_outbox o WHERE 'application:'||o.id=lt_mail_jobs.id)));

-- 確認URLと専用tokenは申請の保持期限まで残さず自身の短い期限で掃除する
UPDATE lt_mail_jobs SET envelope='{}',state='expired',lease_until=NULL WHERE id IN (SELECT 'application:'||p.outbox_id FROM lt_email_change_payloads p JOIN lt_email_change_tokens t ON t.hash=p.token_hash WHERE t.expires<=:now_ms OR t.used=1);
DELETE FROM lt_email_change_payloads WHERE token_hash IN (SELECT hash FROM lt_email_change_tokens WHERE expires<=:now_ms OR used=1);
DELETE FROM lt_email_change_tokens WHERE expires<=:now_ms OR used=1;
