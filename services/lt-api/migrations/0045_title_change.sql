-- タイトル変更の記録を審査通知から分離する
DROP TRIGGER lt_operator_receipt;
CREATE TRIGGER lt_operator_receipt AFTER UPDATE ON lt_applications
WHEN NEW.actor_id IS NOT NULL AND (NEW.operation_id!=OLD.operation_id OR NEW.actor_id IS NOT OLD.actor_id)
BEGIN
 INSERT INTO lt_operator_operations(actor,operation_id,application_id,payload_hash,result,expires) VALUES(NEW.actor_id,NEW.operation_id,NEW.id,NEW.payload_hash,json_set(NEW.dto,'$.operatorNote',NEW.operator_note),(SELECT private_expires FROM lt_events WHERE id=NEW.event_id));
 INSERT INTO lt_outbox(id,operation_id,application_id,kind,recipient,expires)
 SELECT NEW.operation_id||':'||NEW.id,NEW.operation_id,NEW.id,
 CASE WHEN json_extract(NEW.dto,'$.review')='returned' THEN 'returned' WHEN json_extract(NEW.dto,'$.review')='rejected' THEN 'rejected' WHEN json_extract(OLD.dto,'$.review')='resubmitted' AND json_extract(NEW.dto,'$.review')='approved' THEN 'reapproved' ELSE 'withdrawalConfirmed' END,NEW.email,(SELECT private_expires FROM lt_events WHERE id=NEW.event_id)
 WHERE (json_extract(NEW.dto,'$.review') IN ('returned','rejected') AND json_extract(NEW.dto,'$.review')!=json_extract(OLD.dto,'$.review')) OR (json_extract(OLD.dto,'$.review')='resubmitted' AND json_extract(NEW.dto,'$.review')='approved') OR (json_extract(OLD.dto,'$.withdrawal')='requested' AND json_extract(NEW.dto,'$.withdrawal')='confirmed');
END;

DROP TRIGGER lt_review_audit;
CREATE TRIGGER lt_review_audit AFTER UPDATE ON lt_applications
WHEN NEW.actor_id IS NOT NULL AND (NEW.operation_id IS NOT OLD.operation_id OR NEW.actor_id IS NOT OLD.actor_id) AND NOT (json_extract(OLD.dto,'$.everApproved')=0 AND json_extract(NEW.dto,'$.everApproved')=1)
BEGIN
 INSERT INTO lt_audit(id,operation_id,actor_id,action,application_id,expires) VALUES(NEW.operation_id||':'||NEW.id||':audit',NEW.operation_id,NEW.actor_id,CASE WHEN json_extract(NEW.dto,'$.content.title')!=json_extract(OLD.dto,'$.content.title') THEN 'titleChanged' WHEN json_extract(NEW.dto,'$.withdrawal')='confirmed' THEN 'withdrawalConfirmed' WHEN json_extract(OLD.dto,'$.review')='resubmitted' AND json_extract(NEW.dto,'$.review')='approved' THEN 'reapproved' ELSE json_extract(NEW.dto,'$.review') END,NEW.id,(SELECT private_expires FROM lt_events WHERE id=NEW.event_id));
END;
