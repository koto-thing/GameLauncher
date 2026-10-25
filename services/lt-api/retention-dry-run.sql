-- 保持削除は件数表示だけ。公開アーカイブは対象に含めない
SELECT 'applications' AS resource,count(*) AS due FROM lt_applications WHERE json_extract(dto,'$.retentionExpiresAt') IS NOT NULL AND json_extract(dto,'$.retentionExpiresAt')<=strftime('%Y-%m-%dT%H:%M:%fZ',COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000)/1000.0,'unixepoch')
;
SELECT 'tokens',count(*) FROM lt_auth_tokens WHERE expires<=CAST(COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000) AS INTEGER) AND (session_expires IS NULL OR session_expires<=CAST(COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000) AS INTEGER))
;
SELECT 'fake_mail',count(*) FROM lt_fake_mail WHERE expires<=CAST(COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000) AS INTEGER)
;
SELECT 'outbox',count(*) FROM lt_outbox WHERE expires IS NOT NULL AND expires<=CAST(COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000) AS INTEGER);
-- 未設定期限は勝手に推測せず、別件数で報告する
SELECT count(*) AS outbox_without_fixed_expiry FROM lt_outbox WHERE expires IS NULL;

SELECT 'audit' AS resource,count(*) AS due FROM lt_audit WHERE expires<=CAST(COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000) AS INTEGER)
;
SELECT 'approval_receipts',count(*) FROM lt_approval_receipts WHERE expires<=CAST(COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000) AS INTEGER)
;
SELECT 'applicant_operations',count(*) FROM lt_applicant_operations WHERE expires<=CAST(COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000) AS INTEGER)
;
SELECT 'operator_operations',count(*) FROM lt_operator_operations WHERE expires<=CAST(COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000) AS INTEGER)
;
SELECT 'fake_deliveries',count(*) FROM lt_fake_deliveries WHERE expires<=CAST(COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000) AS INTEGER)
;
SELECT 'auth_rate',count(*) FROM lt_auth_rate WHERE bucket<CAST(COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000)/3600000 AS INTEGER);
SELECT 'event_configs' AS resource,count(*) AS due FROM lt_event_configs WHERE expires<=COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000);
SELECT 'event_operations' AS resource,count(*) AS due FROM lt_event_operations WHERE expires<=COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000);
SELECT 'schedule_operations' AS resource,count(*) AS due FROM lt_schedule_operations WHERE expires<=COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000);
SELECT 'event_cancellations' AS resource,count(*) AS due FROM lt_event_cancellations WHERE expires<=COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000);

-- 全体中止だけは旧公開情報も削除候補にする。通常終了archiveは含めない
SELECT 'cancelled_public_events' AS resource,count(*) AS due FROM lt_public_events p JOIN lt_events e ON e.id=p.event_id WHERE e.state='cancelled' AND e.private_expires<=COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000);
SELECT 'cancelled_public_talks' AS resource,count(*) AS due FROM lt_public_talks p JOIN lt_events e ON e.id=p.event_id WHERE e.state='cancelled' AND e.private_expires<=COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000);
