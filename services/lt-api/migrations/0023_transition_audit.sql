ALTER TABLE lt_audit ADD COLUMN occurred_at TEXT NOT NULL DEFAULT '';
CREATE TRIGGER lt_audit_clock AFTER INSERT ON lt_audit WHEN NEW.occurred_at=''
BEGIN UPDATE lt_audit SET occurred_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.id; END;
-- 既存の架空ログは導入観測時刻として区別して記録する
UPDATE lt_audit SET occurred_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE occurred_at='';
CREATE TRIGGER lt_review_audit AFTER UPDATE ON lt_applications
WHEN NEW.actor_id IS NOT NULL AND (NEW.operation_id IS NOT OLD.operation_id OR NEW.actor_id IS NOT OLD.actor_id) AND NOT (json_extract(OLD.dto,'$.everApproved')=0 AND json_extract(NEW.dto,'$.everApproved')=1)
BEGIN
 INSERT INTO lt_audit(id,operation_id,actor_id,action,application_id,expires) VALUES(NEW.operation_id||':'||NEW.id||':audit',NEW.operation_id,NEW.actor_id,CASE WHEN json_extract(NEW.dto,'$.withdrawal')='confirmed' THEN 'withdrawalConfirmed' WHEN json_extract(OLD.dto,'$.review')='resubmitted' AND json_extract(NEW.dto,'$.review')='approved' THEN 'reapproved' ELSE json_extract(NEW.dto,'$.review') END,NEW.id,(SELECT private_expires FROM lt_events WHERE id=NEW.event_id));
END;
CREATE TRIGGER lt_cancel_audit AFTER UPDATE OF state ON lt_events
WHEN NEW.state='cancelled' AND OLD.state!='cancelled' AND NEW.cancel_operation IS NOT NULL
BEGIN INSERT INTO lt_audit(id,operation_id,actor_id,action,application_id,expires) VALUES(NEW.cancel_operation||':cancel-audit',NEW.cancel_operation,NEW.cancel_actor,'eventCancelled',NEW.id,(SELECT private_expires FROM lt_events WHERE id=NEW.id)); END;
CREATE TRIGGER lt_cancel_audit_expiry AFTER UPDATE OF private_expires ON lt_events WHEN NEW.private_expires IS NOT NULL
BEGIN UPDATE lt_audit SET expires=NEW.private_expires WHERE application_id=NEW.id AND action='eventCancelled'; END;
