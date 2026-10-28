-- 開催回の通常受付を自動承認にし、明示指定で手動審査へ切り替える
ALTER TABLE lt_recruitment ADD COLUMN approval_mode TEXT NOT NULL DEFAULT 'automatic' CHECK(approval_mode IN ('automatic','manual'));

-- 即時承認時は承認通知にまとめ、手動審査の場合だけ受付通知を作る
DROP TRIGGER lt_submitted_notification;
CREATE TRIGGER lt_submitted_notification AFTER INSERT ON lt_applications
WHEN (SELECT approval_mode FROM lt_recruitment WHERE event_id=NEW.event_id)='manual'
BEGIN
 INSERT INTO lt_outbox(id,operation_id,application_id,kind,recipient) VALUES(NEW.operation_id||':'||NEW.id,NEW.operation_id,NEW.id,'submitted',NEW.email);
END;

DROP TRIGGER lt_approve_effects;
CREATE TRIGGER lt_approve_effects AFTER UPDATE ON lt_applications
WHEN json_extract(OLD.dto,'$.everApproved')=0 AND json_extract(NEW.dto,'$.everApproved')=1
BEGIN
 INSERT INTO lt_approval_receipts(operation_id,application_id,event_id,application_version,actor_id,payload_hash) VALUES(NEW.operation_id,NEW.id,NEW.event_id,NEW.version,NEW.actor_id,NEW.payload_hash);
 UPDATE lt_recruitment SET reserved=reserved+1 WHERE event_id=NEW.event_id;
 INSERT INTO lt_public_talks(id,event_id,dto,approval_operation) VALUES(NEW.id,NEW.event_id,json_extract(NEW.dto,'$.published'),NEW.operation_id);
 -- 閉会がある場合はその直前へ挿入し、閉会の長さを保って後ろへ移す
 UPDATE lt_schedule SET version=version+1,blocks=(
  WITH appended AS (
   SELECT json_insert(
    CASE WHEN json_extract(blocks,'$[#-1].kind')='closing' THEN json_remove(blocks,'$[#-1]') ELSE blocks END,
    '$[#]',json_object('id',NEW.id,'kind','talk','talkId',NEW.id,'startsAt',json_extract(NEW.dto,'$.published.startsAt'),'endsAt',json_extract(NEW.dto,'$.published.endsAt')),
    '$[#]',json_object('id',NEW.id||':transition','kind','transition','startsAt',json_extract(NEW.dto,'$.published.endsAt'),'endsAt',strftime('%Y-%m-%dT%H:%M:%fZ',json_extract(NEW.dto,'$.published.endsAt'),'+'||(SELECT transition_minutes FROM lt_recruitment WHERE event_id=NEW.event_id)||' minutes'))
   ) AS value
  )
  SELECT CASE WHEN json_extract(blocks,'$[#-1].kind')='closing' THEN
   json_insert(value,'$[#]',json_set(json_extract(blocks,'$[#-1]'),
    '$.startsAt',json_extract(value,'$[#-1].endsAt'),
    '$.endsAt',strftime('%Y-%m-%dT%H:%M:%fZ',json_extract(blocks,'$[#-1].endsAt'),
     '+'||(SELECT talk_minutes+transition_minutes FROM lt_recruitment WHERE event_id=NEW.event_id)||' minutes')))
   ELSE value END FROM appended
 ) WHERE event_id=NEW.event_id;
 UPDATE lt_public_events SET dto=json_set(dto,'$.version',json_extract(dto,'$.version')+1,'$.schedule',json((SELECT blocks FROM lt_schedule WHERE event_id=NEW.event_id)),'$.endsAt',(SELECT json_extract(b.value,'$.endsAt') FROM lt_schedule s,json_each(s.blocks) b WHERE s.event_id=NEW.event_id ORDER BY CAST(b.key AS INTEGER) DESC LIMIT 1)) WHERE event_id=NEW.event_id;
 UPDATE lt_events SET version=version+1 WHERE id=NEW.event_id;
 INSERT INTO lt_outbox(id,operation_id,application_id,kind,recipient) VALUES(NEW.operation_id,NEW.operation_id,NEW.id,'approved',NEW.email);
 INSERT INTO lt_audit(id,operation_id,actor_id,action,application_id) VALUES(NEW.operation_id,NEW.operation_id,NEW.actor_id,'approved',NEW.id);
END;


-- 中止操作の再送でも確定時の承認方式を返す
DROP TRIGGER lt_event_cancel;
CREATE TRIGGER lt_event_cancel AFTER UPDATE OF state ON lt_events
WHEN NEW.state='cancelled' AND OLD.state!='cancelled' AND NEW.cancel_operation IS NOT NULL
BEGIN
 INSERT INTO lt_outbox(id,operation_id,application_id,kind,recipient,expires) SELECT NEW.cancel_operation||':'||a.id,NEW.cancel_operation,a.id,'eventCancelled',a.email,(SELECT private_expires FROM lt_events WHERE id=NEW.id) FROM lt_applications a WHERE a.event_id=NEW.id AND a.active=1 AND json_extract(a.dto,'$.review') NOT IN ('rejected','withdrawn');
 INSERT INTO lt_event_cancellations SELECT NEW.cancel_actor,NEW.cancel_operation,NEW.id,NEW.cancel_hash,json_object('id',NEW.id,'version',NEW.version,'state','cancelled','title',json_extract(p.dto,'$.title'),'venue',json_extract(p.dto,'$.venue'),'guidance',json_extract(p.dto,'$.guidance'),'startsAt',json_extract(p.dto,'$.startsAt'),'timeZone',json_extract(p.dto,'$.timeZone'),'opensAt',strftime('%Y-%m-%dT%H:%M:%fZ',r.opens/1000.0,'unixepoch'),'closesAt',strftime('%Y-%m-%dT%H:%M:%fZ',r.closes/1000.0,'unixepoch'),'capacity',r.capacity,'talkMinutes',r.talk_minutes,'transitionMinutes',r.transition_minutes,'approvalMode',r.approval_mode),e.private_expires FROM lt_events e JOIN lt_public_events p ON p.event_id=e.id JOIN lt_recruitment r ON r.event_id=e.id WHERE e.id=NEW.id;
END;
