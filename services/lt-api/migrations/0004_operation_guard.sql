-- 同じ actor/operationId の別 payload が副作用だけを残さない
CREATE TRIGGER lt_operation_insert_guard BEFORE INSERT ON lt_applications
WHEN EXISTS(SELECT 1 FROM lt_applicant_operations WHERE actor=NEW.email AND operation_id=NEW.operation_id AND (payload_hash!=NEW.payload_hash OR application_id!=NEW.id))
BEGIN SELECT RAISE(ABORT,'LT_OPERATION_CONFLICT'); END;
CREATE TRIGGER lt_operation_update_guard BEFORE UPDATE ON lt_applications
WHEN EXISTS(SELECT 1 FROM lt_applicant_operations WHERE actor=NEW.email AND operation_id=NEW.operation_id AND (payload_hash!=NEW.payload_hash OR application_id!=NEW.id))
BEGIN SELECT RAISE(ABORT,'LT_OPERATION_CONFLICT'); END;
