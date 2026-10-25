ALTER TABLE lt_recruitment ADD COLUMN transition_minutes INTEGER NOT NULL DEFAULT 5;
CREATE TABLE lt_schedule_operations(actor TEXT NOT NULL,operation_id TEXT NOT NULL,event_id TEXT NOT NULL,payload_hash TEXT NOT NULL,result TEXT NOT NULL,expires INTEGER,PRIMARY KEY(actor,operation_id));
ALTER TABLE lt_schedule ADD COLUMN operation_id TEXT;
ALTER TABLE lt_schedule ADD COLUMN actor_id TEXT;
ALTER TABLE lt_schedule ADD COLUMN payload_hash TEXT;
CREATE TRIGGER lt_timetable_effects AFTER UPDATE OF blocks ON lt_schedule
WHEN NEW.operation_id IS NOT NULL AND NEW.operation_id IS NOT OLD.operation_id
BEGIN
 UPDATE lt_applications SET dto=json_set(dto,'$.published.startsAt',(SELECT json_extract(b.value,'$.startsAt') FROM json_each(NEW.blocks) b WHERE json_extract(b.value,'$.talkId')=lt_applications.id),'$.published.endsAt',(SELECT json_extract(b.value,'$.endsAt') FROM json_each(NEW.blocks) b WHERE json_extract(b.value,'$.talkId')=lt_applications.id)) WHERE event_id=NEW.event_id AND json_extract(dto,'$.slotReserved')=1;
 UPDATE lt_public_talks SET dto=(SELECT json_extract(a.dto,'$.published') FROM lt_applications a WHERE a.id=lt_public_talks.id) WHERE event_id=NEW.event_id AND approval_operation IS NOT NULL AND id IN (SELECT id FROM lt_applications WHERE event_id=NEW.event_id AND json_extract(dto,'$.slotReserved')=1);
 UPDATE lt_public_events SET dto=json_set(dto,'$.schedule',json(NEW.blocks),'$.endsAt',COALESCE((SELECT json_extract(b.value,'$.endsAt') FROM json_each(NEW.blocks) b ORDER BY CAST(b.key AS INTEGER) DESC LIMIT 1),json_extract(dto,'$.endsAt')),'$.version',json_extract(dto,'$.version')+1) WHERE event_id=NEW.event_id;
 INSERT INTO lt_schedule_operations SELECT NEW.actor_id,NEW.operation_id,NEW.event_id,NEW.payload_hash,json_object('eventId',NEW.event_id,'version',NEW.version,'eventVersion',e.version,'blocks',json(NEW.blocks)),e.private_expires FROM lt_events e WHERE e.id=NEW.event_id;
END;
