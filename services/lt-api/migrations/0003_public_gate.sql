-- 公開開始は募集開始と同一。未設定既存行は公開しない
ALTER TABLE lt_events ADD COLUMN public_opens_at INTEGER NOT NULL DEFAULT 9007199254740991;
