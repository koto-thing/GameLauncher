ALTER TABLE lt_events ADD COLUMN publish_enabled INTEGER NOT NULL DEFAULT 1 CHECK(publish_enabled IN (0,1));
ALTER TABLE lt_events ADD COLUMN cancel_actor TEXT;
ALTER TABLE lt_events ADD COLUMN cancel_operation TEXT;
ALTER TABLE lt_events ADD COLUMN cancel_hash TEXT;
CREATE TABLE lt_event_cancellations(actor TEXT NOT NULL,operation_id TEXT NOT NULL,event_id TEXT NOT NULL,payload_hash TEXT NOT NULL,result TEXT NOT NULL,expires INTEGER,PRIMARY KEY(actor,operation_id));
CREATE TRIGGER lt_event_cancel AFTER UPDATE OF state ON lt_events
WHEN NEW.state='cancelled' AND OLD.state!='cancelled' AND NEW.cancel_operation IS NOT NULL
BEGIN
 INSERT INTO lt_outbox(id,operation_id,application_id,kind,recipient,expires) SELECT NEW.cancel_operation||':'||a.id,NEW.cancel_operation,a.id,'eventCancelled',a.email,(SELECT private_expires FROM lt_events WHERE id=NEW.id) FROM lt_applications a WHERE a.event_id=NEW.id AND a.active=1 AND json_extract(a.dto,'$.review') NOT IN ('rejected','withdrawn');
 INSERT INTO lt_event_cancellations SELECT NEW.cancel_actor,NEW.cancel_operation,NEW.id,NEW.cancel_hash,json_object('id',NEW.id,'version',NEW.version,'state','cancelled','title',json_extract(p.dto,'$.title'),'venue',json_extract(p.dto,'$.venue'),'guidance',json_extract(p.dto,'$.guidance'),'startsAt',json_extract(p.dto,'$.startsAt'),'timeZone',json_extract(p.dto,'$.timeZone'),'opensAt',strftime('%Y-%m-%dT%H:%M:%fZ',r.opens/1000.0,'unixepoch'),'closesAt',strftime('%Y-%m-%dT%H:%M:%fZ',r.closes/1000.0,'unixepoch'),'capacity',r.capacity,'talkMinutes',r.talk_minutes,'transitionMinutes',r.transition_minutes),e.private_expires FROM lt_events e JOIN lt_public_events p ON p.event_id=e.id JOIN lt_recruitment r ON r.event_id=e.id WHERE e.id=NEW.id;
END;
CREATE TRIGGER lt_cancel_expiry AFTER UPDATE OF private_expires ON lt_events WHEN NEW.private_expires IS NOT NULL
BEGIN UPDATE lt_event_cancellations SET expires=NEW.private_expires WHERE event_id=NEW.id; END;
