-- 承認は単一条件付き UPDATE と trigger 内の副作用にまとめる
ALTER TABLE lt_events ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE lt_recruitment ADD COLUMN talk_minutes INTEGER NOT NULL DEFAULT 10;
CREATE TABLE lt_schedule(event_id TEXT PRIMARY KEY REFERENCES lt_events(id),version INTEGER NOT NULL DEFAULT 1,blocks TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(blocks)));
INSERT INTO lt_schedule(event_id) SELECT id FROM lt_events;
CREATE TABLE lt_approval_receipts(operation_id TEXT PRIMARY KEY,application_id TEXT NOT NULL,event_id TEXT NOT NULL,application_version INTEGER NOT NULL,actor_id TEXT NOT NULL,payload_hash TEXT NOT NULL, UNIQUE(application_id,application_version));
CREATE TABLE lt_outbox(id TEXT PRIMARY KEY,operation_id TEXT NOT NULL,application_id TEXT NOT NULL,kind TEXT NOT NULL,recipient TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',expires INTEGER,UNIQUE(operation_id,kind,application_id));
CREATE TABLE lt_audit(id TEXT PRIMARY KEY,operation_id TEXT NOT NULL,actor_id TEXT NOT NULL,action TEXT NOT NULL,application_id TEXT NOT NULL,UNIQUE(operation_id,action,application_id));
ALTER TABLE lt_applications ADD COLUMN actor_id TEXT;
-- 勝者の承認版と一致する snapshot 以外は DB 境界で拒否する
CREATE TRIGGER lt_public_talk_insert_guard BEFORE INSERT ON lt_public_talks
WHEN NOT EXISTS(SELECT 1 FROM lt_applications a JOIN lt_approval_receipts r ON r.application_id=a.id AND r.application_version=a.version WHERE a.id=NEW.id AND a.event_id=NEW.event_id AND json_extract(a.dto,'$.everApproved')=1 AND json(json_extract(a.dto,'$.published'))=json(NEW.dto))
BEGIN SELECT RAISE(ABORT,'LT_UNAPPROVED_SNAPSHOT'); END;
CREATE TRIGGER lt_public_talk_update_guard BEFORE UPDATE ON lt_public_talks
WHEN NOT EXISTS(SELECT 1 FROM lt_applications a JOIN lt_approval_receipts r ON r.application_id=a.id WHERE a.id=NEW.id AND a.event_id=NEW.event_id AND json_extract(a.dto,'$.everApproved')=1 AND json(json_extract(a.dto,'$.published'))=json(NEW.dto))
BEGIN SELECT RAISE(ABORT,'LT_UNAPPROVED_SNAPSHOT'); END;
CREATE TRIGGER lt_approve_guard BEFORE UPDATE ON lt_applications
WHEN json_extract(OLD.dto,'$.everApproved')=0 AND json_extract(NEW.dto,'$.everApproved')=1
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM lt_recruitment WHERE event_id=NEW.event_id AND reserved<capacity) THEN RAISE(ABORT,'LT_CAPACITY_FULL') END;
END;
CREATE TRIGGER lt_approve_effects AFTER UPDATE ON lt_applications
WHEN json_extract(OLD.dto,'$.everApproved')=0 AND json_extract(NEW.dto,'$.everApproved')=1
BEGIN
 INSERT INTO lt_approval_receipts(operation_id,application_id,event_id,application_version,actor_id,payload_hash) VALUES(NEW.operation_id,NEW.id,NEW.event_id,NEW.version,NEW.actor_id,NEW.payload_hash);
 UPDATE lt_recruitment SET reserved=reserved+1 WHERE event_id=NEW.event_id;
 INSERT INTO lt_public_talks VALUES(NEW.id,NEW.event_id,json_extract(NEW.dto,'$.published'));
 UPDATE lt_schedule SET version=version+1,blocks=json_insert(blocks,'$[#]',json_object('id',NEW.id,'kind','talk','talkId',NEW.id,'startsAt',json_extract(NEW.dto,'$.published.startsAt'),'endsAt',json_extract(NEW.dto,'$.published.endsAt'))) WHERE event_id=NEW.event_id;
 UPDATE lt_public_events SET dto=json_set(dto,'$.version',json_extract(dto,'$.version')+1,'$.schedule',json((SELECT blocks FROM lt_schedule WHERE event_id=NEW.event_id))) WHERE event_id=NEW.event_id;
 UPDATE lt_events SET version=version+1 WHERE id=NEW.event_id;
 INSERT INTO lt_outbox(id,operation_id,application_id,kind,recipient) VALUES(NEW.operation_id,NEW.operation_id,NEW.id,'approved',NEW.email);
 INSERT INTO lt_audit(id,operation_id,actor_id,action,application_id) VALUES(NEW.operation_id,NEW.operation_id,NEW.actor_id,'approved',NEW.id);
END;
