-- 手動受付の未登録メールは空文字で表し、認証済みメールとの重複判定から除外する
ALTER TABLE lt_applications ADD COLUMN registration_source TEXT NOT NULL DEFAULT 'email' CHECK(registration_source IN ('email','manual'));
DROP INDEX lt_application_active;
CREATE UNIQUE INDEX lt_application_active ON lt_applications(event_id,email) WHERE active=1 AND email!='';

-- メールを持たないレコードは明示的な手動受付だけに限定する
CREATE TRIGGER lt_application_email_insert_guard BEFORE INSERT ON lt_applications
WHEN NEW.email='' AND NEW.registration_source!='manual'
BEGIN SELECT RAISE(ABORT,'LT_EMAIL_REQUIRED'); END;
CREATE TRIGGER lt_application_email_update_guard BEFORE UPDATE OF email,registration_source ON lt_applications
WHEN NEW.email='' AND NEW.registration_source!='manual'
BEGIN SELECT RAISE(ABORT,'LT_EMAIL_REQUIRED'); END;

-- 宛先不明の手動受付では通知を生成しない
CREATE TRIGGER lt_outbox_known_recipient BEFORE INSERT ON lt_outbox
WHEN NEW.recipient=''
BEGIN SELECT RAISE(IGNORE); END;
