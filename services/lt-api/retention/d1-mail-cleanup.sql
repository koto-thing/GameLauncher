-- 認証outboxは申請候補とは独立した短期寿命。tokenより先に削除する
DELETE FROM lt_login_outbox WHERE expires<=:now_ms;
-- 正規source削除triggerで連動するが、古い孤立jobも期限到達時だけ掃除する
DELETE FROM lt_mail_jobs WHERE expires*1000<=:now_ms AND (
 (id LIKE 'authentication:%' AND NOT EXISTS(SELECT 1 FROM lt_login_outbox o WHERE 'authentication:'||o.id=lt_mail_jobs.id)) OR
 (id LIKE 'application:%' AND NOT EXISTS(SELECT 1 FROM lt_outbox o WHERE 'application:'||o.id=lt_mail_jobs.id)));
