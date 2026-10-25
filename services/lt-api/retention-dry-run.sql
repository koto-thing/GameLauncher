-- 保持削除は件数表示だけ。公開アーカイブは対象に含めない
SELECT 'applications' AS resource,count(*) AS due FROM lt_applications WHERE json_extract(dto,'$.retentionExpiresAt') IS NOT NULL AND json_extract(dto,'$.retentionExpiresAt')<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
UNION ALL SELECT 'tokens',count(*) FROM lt_auth_tokens WHERE expires<=CAST(unixepoch('subsec')*1000 AS INTEGER) AND (session_expires IS NULL OR session_expires<=CAST(unixepoch('subsec')*1000 AS INTEGER))
UNION ALL SELECT 'fake_mail',count(*) FROM lt_fake_mail WHERE expires<=CAST(unixepoch('subsec')*1000 AS INTEGER)
UNION ALL SELECT 'outbox',count(*) FROM lt_outbox WHERE expires IS NOT NULL AND expires<=CAST(unixepoch('subsec')*1000 AS INTEGER);
-- 未設定期限は勝手に推測せず、別件数で報告する
SELECT count(*) AS outbox_without_fixed_expiry FROM lt_outbox WHERE expires IS NULL;
