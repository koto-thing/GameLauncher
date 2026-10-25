ALTER TABLE lt_applications ADD COLUMN operator_note TEXT NOT NULL DEFAULT '';
CREATE TABLE lt_operator_operations(actor TEXT NOT NULL,operation_id TEXT NOT NULL,application_id TEXT NOT NULL,payload_hash TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(actor,operation_id));
CREATE TRIGGER lt_operator_operation_guard BEFORE UPDATE ON lt_applications
WHEN NEW.actor_id IS NOT NULL AND EXISTS(SELECT 1 FROM lt_operator_operations WHERE actor=NEW.actor_id AND operation_id=NEW.operation_id AND (application_id!=NEW.id OR payload_hash!=NEW.payload_hash))
BEGIN SELECT RAISE(ABORT,'LT_OPERATION_CONFLICT'); END;
CREATE TRIGGER lt_operator_receipt AFTER UPDATE ON lt_applications
WHEN NEW.actor_id IS NOT NULL AND (NEW.operation_id!=OLD.operation_id OR NEW.actor_id IS NOT OLD.actor_id)
BEGIN
 INSERT INTO lt_operator_operations VALUES(NEW.actor_id,NEW.operation_id,NEW.id,NEW.payload_hash,json_set(NEW.dto,'$.operatorNote',NEW.operator_note));
 INSERT INTO lt_outbox(id,operation_id,application_id,kind,recipient)
 SELECT NEW.operation_id||':'||NEW.id,NEW.operation_id,NEW.id,
 CASE WHEN json_extract(NEW.dto,'$.review')='returned' THEN 'returned' WHEN json_extract(NEW.dto,'$.review')='rejected' THEN 'rejected' WHEN json_extract(OLD.dto,'$.review')='resubmitted' AND json_extract(NEW.dto,'$.review')='approved' THEN 'reapproved' ELSE 'withdrawalConfirmed' END,NEW.email
 WHERE json_extract(NEW.dto,'$.review') IN ('returned','rejected') OR (json_extract(OLD.dto,'$.review')='resubmitted' AND json_extract(NEW.dto,'$.review')='approved') OR (json_extract(OLD.dto,'$.withdrawal')='requested' AND json_extract(NEW.dto,'$.withdrawal')='confirmed');
END;
CREATE TRIGGER lt_reapprove_effects AFTER UPDATE ON lt_applications
WHEN json_extract(OLD.dto,'$.everApproved')=1 AND json_extract(OLD.dto,'$.review')='resubmitted' AND json_extract(NEW.dto,'$.review')='approved'
BEGIN
 UPDATE lt_public_talks SET dto=json_extract(NEW.dto,'$.published') WHERE id=NEW.id;
 UPDATE lt_public_events SET dto=json_set(dto,'$.version',json_extract(dto,'$.version')+1) WHERE event_id=NEW.event_id;
END;
CREATE TRIGGER lt_withdraw_effects AFTER UPDATE ON lt_applications
WHEN json_extract(OLD.dto,'$.slotReserved')=1 AND json_extract(NEW.dto,'$.withdrawal')='confirmed'
BEGIN
 UPDATE lt_recruitment SET reserved=reserved-1 WHERE event_id=NEW.event_id;
 UPDATE lt_public_talks SET dto=json_extract(NEW.dto,'$.published') WHERE id=NEW.id;
 UPDATE lt_events SET version=version+1 WHERE id=NEW.event_id;
END;
CREATE TRIGGER lt_submitted_notification AFTER INSERT ON lt_applications
BEGIN
 INSERT INTO lt_outbox(id,operation_id,application_id,kind,recipient) VALUES(NEW.operation_id||':'||NEW.id,NEW.operation_id,NEW.id,'submitted',NEW.email);
END;
