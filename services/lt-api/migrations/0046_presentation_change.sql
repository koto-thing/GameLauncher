-- 概要だけの変更も審査操作と区別して監査に残す
DROP TRIGGER lt_review_audit;
CREATE TRIGGER lt_review_audit AFTER UPDATE ON lt_applications
WHEN NEW.actor_id IS NOT NULL AND (NEW.operation_id IS NOT OLD.operation_id OR NEW.actor_id IS NOT OLD.actor_id) AND NOT (json_extract(OLD.dto,'$.everApproved')=0 AND json_extract(NEW.dto,'$.everApproved')=1)
BEGIN
 INSERT INTO lt_audit(id,operation_id,actor_id,action,application_id,expires) VALUES(NEW.operation_id||':'||NEW.id||':audit',NEW.operation_id,NEW.actor_id,CASE WHEN json_extract(NEW.dto,'$.content.title')!=json_extract(OLD.dto,'$.content.title') OR json_extract(NEW.dto,'$.content.abstract')!=json_extract(OLD.dto,'$.content.abstract') THEN 'presentationChanged' WHEN json_extract(NEW.dto,'$.withdrawal')='confirmed' THEN 'withdrawalConfirmed' WHEN json_extract(OLD.dto,'$.review')='resubmitted' AND json_extract(NEW.dto,'$.review')='approved' THEN 'reapproved' ELSE json_extract(NEW.dto,'$.review') END,NEW.id,(SELECT private_expires FROM lt_events WHERE id=NEW.event_id));
END;
