DROP TRIGGER lt_approve_effects;
CREATE TRIGGER lt_approve_effects AFTER UPDATE ON lt_applications
WHEN json_extract(OLD.dto,'$.everApproved')=0 AND json_extract(NEW.dto,'$.everApproved')=1
BEGIN
 INSERT INTO lt_approval_receipts(operation_id,application_id,event_id,application_version,actor_id,payload_hash) VALUES(NEW.operation_id,NEW.id,NEW.event_id,NEW.version,NEW.actor_id,NEW.payload_hash);
 UPDATE lt_recruitment SET reserved=reserved+1 WHERE event_id=NEW.event_id;
 INSERT INTO lt_public_talks(id,event_id,dto,approval_operation) VALUES(NEW.id,NEW.event_id,json_extract(NEW.dto,'$.published'),NEW.operation_id);
 UPDATE lt_schedule SET version=version+1,blocks=json_insert(blocks,'$[#]',json_object('id',NEW.id,'kind','talk','talkId',NEW.id,'startsAt',json_extract(NEW.dto,'$.published.startsAt'),'endsAt',json_extract(NEW.dto,'$.published.endsAt')),'$[#]',json_object('id',NEW.id||':transition','kind','transition','startsAt',json_extract(NEW.dto,'$.published.endsAt'),'endsAt',strftime('%Y-%m-%dT%H:%M:%fZ',json_extract(NEW.dto,'$.published.endsAt'),'+'||(SELECT transition_minutes FROM lt_recruitment WHERE event_id=NEW.event_id)||' minutes'))) WHERE event_id=NEW.event_id;
 UPDATE lt_public_events SET dto=json_set(dto,'$.version',json_extract(dto,'$.version')+1,'$.schedule',json((SELECT blocks FROM lt_schedule WHERE event_id=NEW.event_id)),'$.endsAt',(SELECT json_extract(b.value,'$.endsAt') FROM lt_schedule s,json_each(s.blocks) b WHERE s.event_id=NEW.event_id ORDER BY CAST(b.key AS INTEGER) DESC LIMIT 1)) WHERE event_id=NEW.event_id;
 UPDATE lt_events SET version=version+1 WHERE id=NEW.event_id;
 INSERT INTO lt_outbox(id,operation_id,application_id,kind,recipient) VALUES(NEW.operation_id,NEW.operation_id,NEW.id,'approved',NEW.email);
 INSERT INTO lt_audit(id,operation_id,actor_id,action,application_id) VALUES(NEW.operation_id,NEW.operation_id,NEW.actor_id,'approved',NEW.id);
END;

