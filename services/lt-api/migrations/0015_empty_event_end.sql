DROP TRIGGER lt_event_config_update_effects;
CREATE TRIGGER lt_event_config_update_effects AFTER UPDATE ON lt_event_configs
BEGIN
 UPDATE lt_events SET version=version+1,public_opens_at=unixepoch(json_extract(NEW.dto,'$.opensAt'),'subsec')*1000 WHERE id=NEW.id;
 UPDATE lt_recruitment SET opens=unixepoch(json_extract(NEW.dto,'$.opensAt'),'subsec')*1000,closes=unixepoch(json_extract(NEW.dto,'$.closesAt'),'subsec')*1000,capacity=json_extract(NEW.dto,'$.capacity'),talk_minutes=json_extract(NEW.dto,'$.talkMinutes'),transition_minutes=json_extract(NEW.dto,'$.transitionMinutes') WHERE event_id=NEW.id;
 UPDATE lt_public_events SET dto=json_set(dto,'$.title',json_extract(NEW.dto,'$.title'),'$.venue',json_extract(NEW.dto,'$.venue'),'$.guidance',json_extract(NEW.dto,'$.guidance'),'$.timeZone',json_extract(NEW.dto,'$.timeZone'),'$.startsAt',json_extract(NEW.dto,'$.startsAt'),'$.endsAt',CASE WHEN (SELECT reserved FROM lt_recruitment WHERE event_id=NEW.id)=0 THEN strftime('%Y-%m-%dT%H:%M:%fZ',json_extract(NEW.dto,'$.startsAt'),'+'||(json_extract(NEW.dto,'$.capacity')*(json_extract(NEW.dto,'$.talkMinutes')+json_extract(NEW.dto,'$.transitionMinutes')))||' minutes') ELSE json_extract(dto,'$.endsAt') END,'$.version',json_extract(dto,'$.version')+1) WHERE event_id=NEW.id;
 INSERT INTO lt_event_operations SELECT NEW.actor,NEW.operation_id,NEW.payload_hash,NEW.id,json_set(NEW.dto,'$.id',NEW.id,'$.version',e.version,'$.state',e.state),e.private_expires FROM lt_events e WHERE e.id=NEW.id;
END;
