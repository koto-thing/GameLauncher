-- 私有receipt削除より前に同じtransactionで実行する。既存公開guardを維持
INSERT INTO lt_archive_markers(talk_id,event_id,snapshot_json)
SELECT p.id,p.event_id,p.dto FROM lt_public_talks p JOIN retention_due d ON d.event_id=p.event_id
WHERE d.kind='ended' AND NOT EXISTS(SELECT 1 FROM lt_archive_markers m WHERE m.talk_id=p.id);
UPDATE lt_public_talks SET approval_operation='lt-archive:v1'
WHERE event_id IN (SELECT event_id FROM retention_due WHERE kind='ended') AND approval_operation!='lt-archive:v1';
DELETE FROM lt_archive_markers WHERE event_id IN (SELECT event_id FROM retention_due WHERE kind='cancelled');
