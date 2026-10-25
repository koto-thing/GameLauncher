ALTER TABLE lt_audit ADD COLUMN expires INTEGER;
ALTER TABLE lt_approval_receipts ADD COLUMN expires INTEGER;
ALTER TABLE lt_applicant_operations ADD COLUMN expires INTEGER;
ALTER TABLE lt_operator_operations ADD COLUMN expires INTEGER;
ALTER TABLE lt_fake_deliveries ADD COLUMN expires INTEGER;
ALTER TABLE lt_events ADD COLUMN private_expires INTEGER;
-- 終了/中止の初回確定からUTC暦3か月を固定提案値とする
CREATE TRIGGER lt_event_retention AFTER UPDATE OF state ON lt_events
WHEN NEW.state IN ('ended','cancelled') AND OLD.private_expires IS NULL
BEGIN
 UPDATE lt_events SET private_expires=CAST(unixepoch('now','+3 months')*1000 AS INTEGER) WHERE id=NEW.id;
 UPDATE lt_applications SET dto=json_set(dto,'$.retentionExpiresAt',strftime('%Y-%m-%dT%H:%M:%fZ','now','+3 months')) WHERE event_id=NEW.id;
 UPDATE lt_outbox SET expires=(SELECT private_expires FROM lt_events WHERE id=NEW.id) WHERE application_id IN (SELECT id FROM lt_applications WHERE event_id=NEW.id);
 UPDATE lt_audit SET expires=(SELECT private_expires FROM lt_events WHERE id=NEW.id) WHERE application_id IN (SELECT id FROM lt_applications WHERE event_id=NEW.id);
 UPDATE lt_approval_receipts SET expires=(SELECT private_expires FROM lt_events WHERE id=NEW.id) WHERE event_id=NEW.id;
 UPDATE lt_applicant_operations SET expires=(SELECT private_expires FROM lt_events WHERE id=NEW.id) WHERE application_id IN (SELECT id FROM lt_applications WHERE event_id=NEW.id);
 UPDATE lt_operator_operations SET expires=(SELECT private_expires FROM lt_events WHERE id=NEW.id) WHERE application_id IN (SELECT id FROM lt_applications WHERE event_id=NEW.id);
 UPDATE lt_fake_deliveries SET expires=(SELECT private_expires FROM lt_events WHERE id=NEW.id) WHERE id IN (SELECT id FROM lt_outbox WHERE application_id IN (SELECT id FROM lt_applications WHERE event_id=NEW.id));
END;

DROP TRIGGER lt_approve_effects;
CREATE TRIGGER lt_approve_effects AFTER UPDATE ON lt_applications
WHEN json_extract(OLD.dto,'$.everApproved')=0 AND json_extract(NEW.dto,'$.everApproved')=1
BEGIN
 INSERT INTO lt_approval_receipts(operation_id,application_id,event_id,application_version,actor_id,payload_hash) VALUES(NEW.operation_id,NEW.id,NEW.event_id,NEW.version,NEW.actor_id,NEW.payload_hash);
 UPDATE lt_recruitment SET reserved=reserved+1 WHERE event_id=NEW.event_id;
 INSERT INTO lt_public_talks(id,event_id,dto,approval_operation) VALUES(NEW.id,NEW.event_id,json_extract(NEW.dto,'$.published'),NEW.operation_id);
 UPDATE lt_schedule SET version=version+1,blocks=json_insert(blocks,'$[#]',json_object('id',NEW.id,'kind','talk','talkId',NEW.id,'startsAt',json_extract(NEW.dto,'$.published.startsAt'),'endsAt',json_extract(NEW.dto,'$.published.endsAt'))) WHERE event_id=NEW.event_id;
 UPDATE lt_public_events SET dto=json_set(dto,'$.version',json_extract(dto,'$.version')+1,'$.schedule',json((SELECT blocks FROM lt_schedule WHERE event_id=NEW.event_id))) WHERE event_id=NEW.event_id;
 UPDATE lt_events SET version=version+1 WHERE id=NEW.event_id;
 INSERT INTO lt_outbox(id,operation_id,application_id,kind,recipient) VALUES(NEW.operation_id,NEW.operation_id,NEW.id,'approved',NEW.email);
 INSERT INTO lt_audit(id,operation_id,actor_id,action,application_id) VALUES(NEW.operation_id,NEW.operation_id,NEW.actor_id,'approved',NEW.id);
END;

DROP TRIGGER lt_operator_receipt;
CREATE TRIGGER lt_operator_receipt AFTER UPDATE ON lt_applications
WHEN NEW.actor_id IS NOT NULL AND (NEW.operation_id!=OLD.operation_id OR NEW.actor_id IS NOT OLD.actor_id)
BEGIN
 INSERT INTO lt_operator_operations(actor,operation_id,application_id,payload_hash,result) VALUES(NEW.actor_id,NEW.operation_id,NEW.id,NEW.payload_hash,json_set(NEW.dto,'$.operatorNote',NEW.operator_note));
 INSERT INTO lt_outbox(id,operation_id,application_id,kind,recipient)
 SELECT NEW.operation_id||':'||NEW.id,NEW.operation_id,NEW.id,
 CASE WHEN json_extract(NEW.dto,'$.review')='returned' THEN 'returned' WHEN json_extract(NEW.dto,'$.review')='rejected' THEN 'rejected' WHEN json_extract(OLD.dto,'$.review')='resubmitted' AND json_extract(NEW.dto,'$.review')='approved' THEN 'reapproved' ELSE 'withdrawalConfirmed' END,NEW.email
 WHERE json_extract(NEW.dto,'$.review') IN ('returned','rejected') OR (json_extract(OLD.dto,'$.review')='resubmitted' AND json_extract(NEW.dto,'$.review')='approved') OR (json_extract(OLD.dto,'$.withdrawal')='requested' AND json_extract(NEW.dto,'$.withdrawal')='confirmed');
END;
