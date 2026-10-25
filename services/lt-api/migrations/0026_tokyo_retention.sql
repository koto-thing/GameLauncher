-- 日本時間の同日時から3暦月後。該当しない日は月末へ補正する
DROP TRIGGER lt_event_retention;
CREATE TRIGGER lt_event_retention AFTER UPDATE OF state ON lt_events
WHEN NEW.state IN ('ended','cancelled') AND OLD.private_expires IS NULL
BEGIN
 UPDATE lt_events SET private_expires=CAST(unixepoch(COALESCE(NEW.ended_at,NEW.cancelled_at,strftime('%Y-%m-%dT%H:%M:%fZ',(COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000))/1000.0,'unixepoch')),'+9 hours','+3 months','floor','-9 hours','subsec')*1000 AS INTEGER) WHERE id=NEW.id;
 UPDATE lt_applications SET dto=json_set(dto,'$.retentionExpiresAt',strftime('%Y-%m-%dT%H:%M:%fZ',(SELECT private_expires FROM lt_events WHERE id=NEW.id)/1000.0,'unixepoch')) WHERE event_id=NEW.id;
 UPDATE lt_outbox SET expires=(SELECT private_expires FROM lt_events WHERE id=NEW.id) WHERE application_id IN (SELECT id FROM lt_applications WHERE event_id=NEW.id);
 UPDATE lt_audit SET expires=(SELECT private_expires FROM lt_events WHERE id=NEW.id) WHERE application_id IN (SELECT id FROM lt_applications WHERE event_id=NEW.id);
 UPDATE lt_approval_receipts SET expires=(SELECT private_expires FROM lt_events WHERE id=NEW.id) WHERE event_id=NEW.id;
 UPDATE lt_applicant_operations SET expires=(SELECT private_expires FROM lt_events WHERE id=NEW.id) WHERE application_id IN (SELECT id FROM lt_applications WHERE event_id=NEW.id);
 UPDATE lt_operator_operations SET expires=(SELECT private_expires FROM lt_events WHERE id=NEW.id) WHERE application_id IN (SELECT id FROM lt_applications WHERE event_id=NEW.id);
 UPDATE lt_fake_deliveries SET expires=(SELECT private_expires FROM lt_events WHERE id=NEW.id) WHERE id IN (SELECT id FROM lt_outbox WHERE application_id IN (SELECT id FROM lt_applications WHERE event_id=NEW.id));
END;
