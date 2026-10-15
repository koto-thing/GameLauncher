-- Apply only after the reviewed operator inventory preflight; no role changes
CREATE VIEW IF NOT EXISTS active_platform_roles AS SELECT r.* FROM platform_roles r
    JOIN operator_admissions a ON a.github_user_id=r.github_user_id
    WHERE a.revoked_at IS NULL AND r.role IN ('admin','executive','assistant');
CREATE TABLE IF NOT EXISTS operator_admissions (
    github_user_id TEXT PRIMARY KEY REFERENCES users(github_user_id),
    approved_login TEXT NOT NULL, version TEXT NOT NULL, revoked_at TEXT
  );
CREATE TABLE IF NOT EXISTS operator_invitations (
    id TEXT PRIMARY KEY, recipient TEXT NOT NULL, login TEXT NOT NULL, avatar_url TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('assistant','executive','admin')),
    issuer TEXT NOT NULL REFERENCES users(github_user_id), issuer_role TEXT NOT NULL, issuer_version TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('invite','reapprove')),
    expires_at TEXT NOT NULL, accepted_at TEXT, accepted_token TEXT, revoked_at TEXT
  );
CREATE UNIQUE INDEX IF NOT EXISTS operator_invitation_pending ON operator_invitations(recipient)
    WHERE accepted_at IS NULL AND revoked_at IS NULL;
INSERT INTO operator_admissions(github_user_id,approved_login,version)
SELECT u.github_user_id,u.login_snapshot,lower(hex(randomblob(16))) FROM users u
JOIN platform_roles r ON r.github_user_id=u.github_user_id
WHERE r.role IN ('admin','executive','assistant')
ON CONFLICT(github_user_id) DO NOTHING;
