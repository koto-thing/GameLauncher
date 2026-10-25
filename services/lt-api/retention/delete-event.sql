-- 呼出側は同一トランザクション内に以下の一時表を作成する
-- retention_due(event_id,kind)、retention_apps(id,email)、retention_outbox(id)
DELETE FROM lt_fake_deliveries WHERE id IN (SELECT id FROM retention_outbox);
DELETE FROM lt_outbox WHERE id IN (SELECT id FROM retention_outbox);
DELETE FROM lt_audit WHERE (action!='eventCancelled' AND application_id IN (SELECT id FROM retention_apps)) OR (action='eventCancelled' AND application_id IN (SELECT event_id FROM retention_due));
DELETE FROM lt_approval_receipts WHERE event_id IN (SELECT event_id FROM retention_due);
DELETE FROM lt_applicant_operations WHERE application_id IN (SELECT id FROM retention_apps);
DELETE FROM lt_operator_operations WHERE application_id IN (SELECT id FROM retention_apps);
DELETE FROM lt_schedule_operations WHERE event_id IN (SELECT event_id FROM retention_due);
DELETE FROM lt_event_operations WHERE event_id IN (SELECT event_id FROM retention_due);
DELETE FROM lt_event_cancellations WHERE event_id IN (SELECT event_id FROM retention_due);
DELETE FROM lt_event_configs WHERE id IN (SELECT event_id FROM retention_due);
DELETE FROM lt_applications WHERE id IN (SELECT id FROM retention_apps);
DELETE FROM lt_schedule WHERE event_id IN (SELECT event_id FROM retention_due);
DELETE FROM lt_recruitment WHERE event_id IN (SELECT event_id FROM retention_due);
-- 通常の公開DTOと不透明な承認識別子は保持する。公開snapshot更新guardを迂回しない
DELETE FROM lt_public_talks WHERE event_id IN (SELECT event_id FROM retention_due WHERE kind='cancelled');
DELETE FROM lt_public_events WHERE event_id IN (SELECT event_id FROM retention_due WHERE kind='cancelled');
-- 外部キーと再実行のため個人情報を含まない開催回tombstoneは保持する
UPDATE lt_events SET cancel_actor=NULL,cancel_operation=NULL,cancel_hash=NULL WHERE id IN (SELECT event_id FROM retention_due);
