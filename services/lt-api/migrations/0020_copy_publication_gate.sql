DROP TRIGGER lt_event_config_insert_guard;
CREATE TRIGGER lt_event_config_insert_guard BEFORE INSERT ON lt_event_configs
BEGIN
 SELECT CASE WHEN NEW.source_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM lt_events WHERE id=NEW.source_id AND version=NEW.source_version) THEN RAISE(ABORT,'LT_VERSION_CONFLICT') END;
 SELECT CASE WHEN NEW.source_id IS NULL AND EXISTS(SELECT 1 FROM lt_recruitment r JOIN lt_events e ON e.id=r.event_id WHERE e.state IN ('scheduled','started') AND e.publish_enabled=1 AND r.opens<unixepoch(json_extract(NEW.dto,'$.closesAt'),'subsec')*1000 AND r.closes>unixepoch(json_extract(NEW.dto,'$.opensAt'),'subsec')*1000) THEN RAISE(ABORT,'LT_RECRUITMENT_OVERLAP') END;
END;

DROP TRIGGER lt_event_config_insert_effects;
CREATE TRIGGER lt_event_config_insert_effects AFTER INSERT ON lt_event_configs
BEGIN
 INSERT INTO lt_events(id,state,version,publish_enabled,public_opens_at) VALUES(NEW.id,'scheduled',1,CASE WHEN NEW.source_id IS NULL THEN 1 ELSE 0 END,unixepoch(json_extract(NEW.dto,'$.opensAt'),'subsec')*1000);
 INSERT INTO lt_recruitment(event_id,opens,closes,capacity,talk_minutes,transition_minutes) VALUES(NEW.id,unixepoch(json_extract(NEW.dto,'$.opensAt'),'subsec')*1000,unixepoch(json_extract(NEW.dto,'$.closesAt'),'subsec')*1000,json_extract(NEW.dto,'$.capacity'),json_extract(NEW.dto,'$.talkMinutes'),json_extract(NEW.dto,'$.transitionMinutes'));
 INSERT INTO lt_schedule(event_id) VALUES(NEW.id);
 INSERT INTO lt_public_events VALUES(NEW.id,json_object('id',NEW.id,'version',1,'title',json_extract(NEW.dto,'$.title'),'venue',json_extract(NEW.dto,'$.venue'),'guidance',json_extract(NEW.dto,'$.guidance'),'startsAt',json_extract(NEW.dto,'$.startsAt'),'endsAt',strftime('%Y-%m-%dT%H:%M:%fZ',json_extract(NEW.dto,'$.startsAt'),'+'||(json_extract(NEW.dto,'$.capacity')*(json_extract(NEW.dto,'$.talkMinutes')+json_extract(NEW.dto,'$.transitionMinutes')))||' minutes'),'timeZone',json_extract(NEW.dto,'$.timeZone'),'recruitment','upcoming','schedule',json('[]')));
 INSERT INTO lt_event_operations VALUES(NEW.actor,NEW.operation_id,NEW.payload_hash,NEW.id,json_set(NEW.dto,'$.id',NEW.id,'$.version',1,'$.state','scheduled'),NULL);
END;

DROP TRIGGER lt_event_config_update_guard;
CREATE TRIGGER lt_event_config_update_guard BEFORE UPDATE OF dto,actor,operation_id,payload_hash,expected_version ON lt_event_configs
BEGIN
 SELECT CASE WHEN (SELECT publish_enabled FROM lt_events WHERE id=NEW.id)=0 AND json_extract(OLD.dto,'$.opensAt')=json_extract(NEW.dto,'$.opensAt') AND json_extract(OLD.dto,'$.closesAt')=json_extract(NEW.dto,'$.closesAt') THEN RAISE(ABORT,'LT_INVALID_TIMING_CHANGE') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM lt_events WHERE id=NEW.id AND version=NEW.expected_version AND (private_expires IS NULL OR private_expires>unixepoch('subsec')*1000)) THEN RAISE(ABORT,'LT_VERSION_CONFLICT') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM lt_recruitment r JOIN lt_events e ON e.id=r.event_id WHERE e.id!=NEW.id AND e.state IN ('scheduled','started') AND e.publish_enabled=1 AND r.opens<unixepoch(json_extract(NEW.dto,'$.closesAt'),'subsec')*1000 AND r.closes>unixepoch(json_extract(NEW.dto,'$.opensAt'),'subsec')*1000) THEN RAISE(ABORT,'LT_RECRUITMENT_OVERLAP') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM lt_recruitment WHERE event_id=NEW.id AND reserved>json_extract(NEW.dto,'$.capacity')) THEN RAISE(ABORT,'LT_CAPACITY_FULL') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM lt_recruitment WHERE event_id=NEW.id AND reserved>0 AND (talk_minutes!=json_extract(NEW.dto,'$.talkMinutes') OR transition_minutes!=json_extract(NEW.dto,'$.transitionMinutes') OR json_extract(OLD.dto,'$.startsAt')!=json_extract(NEW.dto,'$.startsAt'))) THEN RAISE(ABORT,'LT_INVALID_TIMING_CHANGE') END;
END;
DROP TRIGGER lt_event_config_update_effects;
CREATE TRIGGER lt_event_config_update_effects AFTER UPDATE OF dto,actor,operation_id,payload_hash,expected_version ON lt_event_configs
BEGIN
 UPDATE lt_events SET version=version+1,publish_enabled=1,public_opens_at=unixepoch(json_extract(NEW.dto,'$.opensAt'),'subsec')*1000 WHERE id=NEW.id;
 UPDATE lt_recruitment SET opens=unixepoch(json_extract(NEW.dto,'$.opensAt'),'subsec')*1000,closes=unixepoch(json_extract(NEW.dto,'$.closesAt'),'subsec')*1000,capacity=json_extract(NEW.dto,'$.capacity'),talk_minutes=json_extract(NEW.dto,'$.talkMinutes'),transition_minutes=json_extract(NEW.dto,'$.transitionMinutes') WHERE event_id=NEW.id;
 UPDATE lt_public_events SET dto=json_set(dto,'$.title',json_extract(NEW.dto,'$.title'),'$.venue',json_extract(NEW.dto,'$.venue'),'$.guidance',json_extract(NEW.dto,'$.guidance'),'$.timeZone',json_extract(NEW.dto,'$.timeZone'),'$.startsAt',json_extract(NEW.dto,'$.startsAt'),'$.endsAt',CASE WHEN (SELECT json_array_length(blocks) FROM lt_schedule WHERE event_id=NEW.id)=0 THEN strftime('%Y-%m-%dT%H:%M:%fZ',json_extract(NEW.dto,'$.startsAt'),'+'||(json_extract(NEW.dto,'$.capacity')*(json_extract(NEW.dto,'$.talkMinutes')+json_extract(NEW.dto,'$.transitionMinutes')))||' minutes') ELSE json_extract(dto,'$.endsAt') END,'$.version',json_extract(dto,'$.version')+1) WHERE event_id=NEW.id;
 INSERT INTO lt_event_operations SELECT NEW.actor,NEW.operation_id,NEW.payload_hash,NEW.id,json_set(NEW.dto,'$.id',NEW.id,'$.version',e.version,'$.state',e.state),e.private_expires FROM lt_events e WHERE e.id=NEW.id;
END;

