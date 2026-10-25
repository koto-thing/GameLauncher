-- 保持削除は件数表示だけ。公開アーカイブは対象に含めない
SELECT 'applications' AS resource,count(*) AS due FROM lt_applications WHERE json_extract(dto,'$.retentionExpiresAt') IS NOT NULL AND json_extract(dto,'$.retentionExpiresAt')<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
;
SELECT 'tokens',count(*) FROM lt_auth_tokens WHERE expires<=CAST(unixepoch('subsec')*1000 AS INTEGER) AND (session_expires IS NULL OR session_expires<=CAST(unixepoch('subsec')*1000 AS INTEGER))
;
SELECT 'fake_mail',count(*) FROM lt_fake_mail WHERE expires<=CAST(unixepoch('subsec')*1000 AS INTEGER)
;
SELECT 'outbox',count(*) FROM lt_outbox WHERE expires IS NOT NULL AND expires<=CAST(unixepoch('subsec')*1000 AS INTEGER);
-- 未設定期限は勝手に推測せず、別件数で報告する
SELECT count(*) AS outbox_without_fixed_expiry FROM lt_outbox WHERE expires IS NULL;

SELECT 'audit' AS resource,count(*) AS due FROM lt_audit WHERE expires<=CAST(unixepoch('subsec')*1000 AS INTEGER)
;
SELECT 'approval_receipts',count(*) FROM lt_approval_receipts WHERE expires<=CAST(unixepoch('subsec')*1000 AS INTEGER)
;
SELECT 'applicant_operations',count(*) FROM lt_applicant_operations WHERE expires<=CAST(unixepoch('subsec')*1000 AS INTEGER)
;
SELECT 'operator_operations',count(*) FROM lt_operator_operations WHERE expires<=CAST(unixepoch('subsec')*1000 AS INTEGER)
;
SELECT 'fake_deliveries',count(*) FROM lt_fake_deliveries WHERE expires<=CAST(unixepoch('subsec')*1000 AS INTEGER)
;
SELECT 'auth_rate',count(*) FROM lt_auth_rate WHERE bucket<CAST(unixepoch('subsec')/3600 AS INTEGER);
