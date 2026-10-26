-- 開催回削除候補とは独立に、後日失効した孤立情報も毎回拾う
DELETE FROM lt_auth_tokens WHERE expires<=:now_ms AND (session_expires IS NULL OR session_expires<=:now_ms)
AND NOT EXISTS(SELECT 1 FROM lt_applications a WHERE a.email=lt_auth_tokens.email);
DELETE FROM lt_fake_mail WHERE expires<=:now_ms
AND NOT EXISTS(SELECT 1 FROM lt_applications a WHERE a.email=lt_fake_mail.recipient);
