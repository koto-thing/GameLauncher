-- メール変更の私有子をoutbox・申請より先に削除する
DELETE FROM lt_email_change_payloads WHERE outbox_id IN (SELECT id FROM retention_outbox) OR token_hash IN (SELECT hash FROM lt_email_change_tokens WHERE request_id IN (SELECT id FROM lt_email_changes WHERE application_id IN (SELECT id FROM retention_apps)));
DELETE FROM lt_email_change_tokens WHERE request_id IN (SELECT id FROM lt_email_changes WHERE application_id IN (SELECT id FROM retention_apps));
DELETE FROM lt_email_change_operations WHERE application_id IN (SELECT id FROM retention_apps);
DELETE FROM lt_email_change_audit WHERE event_id IN (SELECT event_id FROM retention_due);
DELETE FROM lt_email_changes WHERE application_id IN (SELECT id FROM retention_apps);
-- 呼出側は同一トランザクション内に以下の一時表を作成する
-- retention_due(event_id,kind)、retention_apps(id,email)、retention_outbox(id)
