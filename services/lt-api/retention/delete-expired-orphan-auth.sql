-- 開催回削除とは別の孤立認証情報処理。同じ候補集合を利用する
-- 未期限切れのsession/tokenや別開催の残存申請があるemailは消さない
DELETE FROM lt_auth_tokens WHERE email IN (SELECT email FROM retention_apps)
AND expires<=:now_ms AND (session_expires IS NULL OR session_expires<=:now_ms)
AND NOT EXISTS(SELECT 1 FROM lt_applications a WHERE a.email=lt_auth_tokens.email);
DELETE FROM lt_fake_mail WHERE recipient IN (SELECT email FROM retention_apps) AND expires<=:now_ms
AND NOT EXISTS(SELECT 1 FROM lt_applications a WHERE a.email=lt_fake_mail.recipient);
-- lt_auth_rateはemail_hashのみで開催回への帰属がないため保持する
