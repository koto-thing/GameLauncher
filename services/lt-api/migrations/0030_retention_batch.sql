-- 統合担当用schema案。番号付きmigration/APIには未適用
-- 保存するのは既に公開承認済みのsnapshotだけ。operationId/actor/emailは保存しない
CREATE TABLE lt_archive_markers(talk_id TEXT PRIMARY KEY,event_id TEXT NOT NULL,snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)));
CREATE TRIGGER lt_archive_marker_guard BEFORE INSERT ON lt_archive_markers
WHEN NOT EXISTS(SELECT 1 FROM lt_public_talks p JOIN lt_applications a ON a.id=p.id AND a.event_id=p.event_id
JOIN lt_approval_receipts r ON r.application_id=a.id
WHERE p.id=NEW.talk_id AND p.event_id=NEW.event_id AND json(p.dto)=json(NEW.snapshot_json)
AND json_extract(a.dto,'$.everApproved')=1 AND json(json_extract(a.dto,'$.published'))=json(p.dto))
BEGIN SELECT RAISE(ABORT,'LT_ARCHIVE_APPROVAL_REQUIRED'); END;
CREATE TRIGGER lt_archive_marker_immutable BEFORE UPDATE ON lt_archive_markers
BEGIN SELECT RAISE(ABORT,'LT_ARCHIVE_MARKER_IMMUTABLE'); END;

-- 一回のatomic batch内だけ存在する候補。終了時に全て削除する
CREATE TABLE lt_retention_guard(id TEXT PRIMARY KEY,valid INTEGER NOT NULL CHECK(valid=1),event_id TEXT NOT NULL,kind TEXT NOT NULL);
CREATE TABLE lt_retention_apps(run_id TEXT NOT NULL,id TEXT NOT NULL,email TEXT NOT NULL,PRIMARY KEY(run_id,id));
CREATE TABLE lt_retention_outbox(run_id TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(run_id,id));
