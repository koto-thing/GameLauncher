-- 確認 token は SHA-256 のみ保存。fake outbox はローカル開発用の隔離テーブル
CREATE TABLE lt_auth_tokens(hash TEXT PRIMARY KEY, email TEXT NOT NULL, purpose TEXT NOT NULL CHECK(purpose='login'), expires INTEGER NOT NULL, session_hash TEXT UNIQUE, session_expires INTEGER);
CREATE TABLE lt_fake_mail(id TEXT PRIMARY KEY, recipient TEXT NOT NULL, confirmation_url TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE lt_auth_rate(email_hash TEXT NOT NULL, bucket INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(email_hash,bucket));
CREATE TABLE lt_recruitment(event_id TEXT PRIMARY KEY REFERENCES lt_events(id), opens INTEGER NOT NULL, closes INTEGER NOT NULL, capacity INTEGER NOT NULL CHECK(capacity>0), reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved>=0 AND reserved<=capacity));
CREATE TABLE lt_applications(id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES lt_events(id), email TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0), dto TEXT NOT NULL CHECK(json_valid(dto)), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), operation_id TEXT NOT NULL, payload_hash TEXT NOT NULL);
CREATE UNIQUE INDEX lt_application_active ON lt_applications(event_id,email) WHERE active=1;
CREATE TABLE lt_applicant_operations(actor TEXT NOT NULL, operation_id TEXT NOT NULL, payload_hash TEXT NOT NULL, application_id TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(actor,operation_id));
