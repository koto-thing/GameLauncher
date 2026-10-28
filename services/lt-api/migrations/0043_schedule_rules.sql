-- 時間割ルールと終了上限を開催回ごとに保持する
ALTER TABLE lt_recruitment ADD COLUMN schedule_mode TEXT NOT NULL DEFAULT 'automatic' CHECK(schedule_mode IN ('automatic','manual'));
ALTER TABLE lt_recruitment ADD COLUMN opening_minutes INTEGER NOT NULL DEFAULT 5 CHECK(opening_minutes>=0);
ALTER TABLE lt_recruitment ADD COLUMN break_every INTEGER NOT NULL DEFAULT 4 CHECK(break_every>0);
ALTER TABLE lt_recruitment ADD COLUMN break_minutes INTEGER NOT NULL DEFAULT 10 CHECK(break_minutes>=0);
ALTER TABLE lt_recruitment ADD COLUMN closing_minutes INTEGER NOT NULL DEFAULT 5 CHECK(closing_minutes>=0);
ALTER TABLE lt_recruitment ADD COLUMN ends_by TEXT;

-- 保存済みの発表順を維持し、休憩は最後の発表の後には作らない
CREATE VIEW lt_generated_schedule AS
WITH talks AS (
 SELECT s.event_id,json_extract(b.value,'$.id') AS id,json_extract(b.value,'$.talkId') AS talk_id,
  row_number() OVER(PARTITION BY s.event_id ORDER BY CAST(b.key AS INTEGER)) AS position,
  count(*) OVER(PARTITION BY s.event_id) AS total
 FROM lt_schedule s,json_each(s.blocks) b WHERE json_extract(b.value,'$.kind')='talk'
), pieces AS (
 SELECT event_id,'auto:opening' AS id,'opening' AS kind,NULL AS talk_id,0 AS position,opening_minutes*60000 AS duration
 FROM lt_recruitment WHERE opening_minutes>0
 UNION ALL
 SELECT t.event_id,t.id,'talk',t.talk_id,t.position*3-2,r.talk_minutes*60000 FROM talks t JOIN lt_recruitment r ON r.event_id=t.event_id
 UNION ALL
 SELECT t.event_id,t.id||':transition','transition',NULL,t.position*3-1,r.transition_minutes*60000 FROM talks t JOIN lt_recruitment r ON r.event_id=t.event_id
 UNION ALL
 SELECT t.event_id,'auto:break:'||t.talk_id,'break',NULL,t.position*3,r.break_minutes*60000 FROM talks t JOIN lt_recruitment r ON r.event_id=t.event_id
 WHERE t.position%r.break_every=0 AND t.position<t.total AND r.break_minutes>0
 UNION ALL
 SELECT r.event_id,'auto:closing','closing',NULL,COALESCE((SELECT max(position) FROM talks t WHERE t.event_id=r.event_id),0)*3+1,r.closing_minutes*60000
 FROM lt_recruitment r WHERE r.closing_minutes>0
), timed AS (
 SELECT *,COALESCE(sum(duration) OVER(PARTITION BY event_id ORDER BY position ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS offset_ms
 FROM pieces
), encoded AS (
 SELECT t.event_id,t.position,
  json_object('id',t.id,'kind',t.kind,
   'startsAt',strftime('%Y-%m-%dT%H:%M:%fZ',(unixepoch(json_extract(p.dto,'$.startsAt'),'subsec')*1000+t.offset_ms)/1000.0,'unixepoch'),
   'endsAt',strftime('%Y-%m-%dT%H:%M:%fZ',(unixepoch(json_extract(p.dto,'$.startsAt'),'subsec')*1000+t.offset_ms+t.duration)/1000.0,'unixepoch')) AS block,
  t.talk_id
 FROM timed t JOIN lt_public_events p ON p.event_id=t.event_id
)
SELECT s.event_id,COALESCE((SELECT json_group_array(json(block)) FROM (
 SELECT CASE WHEN talk_id IS NOT NULL THEN json_set(block,'$.talkId',talk_id) ELSE block END AS block
 FROM encoded WHERE event_id=s.event_id ORDER BY position
)),'[]') AS blocks FROM lt_schedule s;

-- 手動時間割では各補助枠の長さと順番を保ち、発表・転換だけ共通時間へ揃える
CREATE VIEW lt_reflowed_schedule AS
WITH pieces AS (
 SELECT s.event_id,CAST(b.key AS INTEGER) AS position,b.value AS block,
  CASE json_extract(b.value,'$.kind') WHEN 'talk' THEN r.talk_minutes*60000 WHEN 'transition' THEN r.transition_minutes*60000
   ELSE CAST((unixepoch(json_extract(b.value,'$.endsAt'),'subsec')-unixepoch(json_extract(b.value,'$.startsAt'),'subsec'))*1000 AS INTEGER) END AS duration
 FROM lt_schedule s JOIN lt_recruitment r ON r.event_id=s.event_id,json_each(s.blocks) b
), timed AS (
 SELECT *,COALESCE(sum(duration) OVER(PARTITION BY event_id ORDER BY position ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS offset_ms FROM pieces
)
SELECT s.event_id,COALESCE((SELECT json_group_array(json(block)) FROM (
 SELECT json_set(t.block,
  '$.startsAt',strftime('%Y-%m-%dT%H:%M:%fZ',(unixepoch(json_extract(p.dto,'$.startsAt'),'subsec')*1000+t.offset_ms)/1000.0,'unixepoch'),
  '$.endsAt',strftime('%Y-%m-%dT%H:%M:%fZ',(unixepoch(json_extract(p.dto,'$.startsAt'),'subsec')*1000+t.offset_ms+t.duration)/1000.0,'unixepoch')) AS block
 FROM timed t JOIN lt_public_events p ON p.event_id=t.event_id WHERE t.event_id=s.event_id ORDER BY t.position
)),'[]') AS blocks FROM lt_schedule s;

-- 終了上限を超える更新は、申請・承認・通知を含むトランザクションごと拒否する
CREATE TRIGGER lt_schedule_end_limit BEFORE UPDATE OF blocks ON lt_schedule
WHEN EXISTS(SELECT 1 FROM lt_recruitment r WHERE r.event_id=NEW.event_id AND r.ends_by IS NOT NULL AND json_extract(NEW.blocks,'$[#-1].endsAt')>r.ends_by)
BEGIN SELECT RAISE(ABORT,'LT_SCHEDULE_FULL'); END;

-- 終了後・開始後の時刻変更は許可せず、開催前の設定変更は再配置へ進める
DROP TRIGGER lt_config_schedule_time_guard;
CREATE TRIGGER lt_config_schedule_time_guard BEFORE UPDATE OF dto ON lt_event_configs
WHEN (SELECT state FROM lt_events WHERE id=NEW.id)!='scheduled' AND (
 json_extract(OLD.dto,'$.startsAt')!=json_extract(NEW.dto,'$.startsAt') OR
 json_extract(OLD.dto,'$.talkMinutes')!=json_extract(NEW.dto,'$.talkMinutes') OR
 json_extract(OLD.dto,'$.transitionMinutes')!=json_extract(NEW.dto,'$.transitionMinutes') OR
 json_extract(OLD.dto,'$.scheduleMode') IS NOT json_extract(NEW.dto,'$.scheduleMode') OR
 json_extract(OLD.dto,'$.openingMinutes') IS NOT json_extract(NEW.dto,'$.openingMinutes') OR
 json_extract(OLD.dto,'$.breakEvery') IS NOT json_extract(NEW.dto,'$.breakEvery') OR
 json_extract(OLD.dto,'$.breakMinutes') IS NOT json_extract(NEW.dto,'$.breakMinutes') OR
 json_extract(OLD.dto,'$.closingMinutes') IS NOT json_extract(NEW.dto,'$.closingMinutes') OR
 json_extract(OLD.dto,'$.endsBy') IS NOT json_extract(NEW.dto,'$.endsBy'))
BEGIN SELECT RAISE(ABORT,'LT_INVALID_TIMING_CHANGE'); END;

-- 予約済み件数の検査を保ち、開催前の時刻変更を受け付ける
DROP TRIGGER lt_event_config_update_guard;
CREATE TRIGGER lt_event_config_update_guard BEFORE UPDATE OF dto,actor,operation_id,payload_hash,expected_version ON lt_event_configs
BEGIN
 SELECT CASE WHEN (SELECT publish_enabled FROM lt_events WHERE id=NEW.id)=0 AND json_extract(OLD.dto,'$.opensAt')=json_extract(NEW.dto,'$.opensAt') AND json_extract(OLD.dto,'$.closesAt')=json_extract(NEW.dto,'$.closesAt') THEN RAISE(ABORT,'LT_INVALID_TIMING_CHANGE') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM lt_events WHERE id=NEW.id AND version=NEW.expected_version AND (private_expires IS NULL OR private_expires>unixepoch('subsec')*1000)) THEN RAISE(ABORT,'LT_VERSION_CONFLICT') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM lt_recruitment r JOIN lt_events e ON e.id=r.event_id WHERE e.id!=NEW.id AND e.state IN ('scheduled','started') AND e.publish_enabled=1 AND r.opens<unixepoch(json_extract(NEW.dto,'$.closesAt'),'subsec')*1000 AND r.closes>unixepoch(json_extract(NEW.dto,'$.opensAt'),'subsec')*1000) THEN RAISE(ABORT,'LT_RECRUITMENT_OVERLAP') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM lt_recruitment WHERE event_id=NEW.id AND reserved>json_extract(NEW.dto,'$.capacity')) THEN CASE WHEN json_extract(NEW.dto,'$.endsBy') IS NOT NULL THEN RAISE(ABORT,'LT_SCHEDULE_FULL') ELSE RAISE(ABORT,'LT_CAPACITY_FULL') END END;
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
 -- 自動時間割は最新の発表順とルールから再生成する
 UPDATE lt_schedule SET blocks=(SELECT g.blocks FROM lt_generated_schedule g WHERE g.event_id=NEW.event_id),
  version=version+1,operation_id=NEW.operation_id||':generated',actor_id=NEW.actor_id,payload_hash=NEW.payload_hash
 WHERE event_id=NEW.event_id AND (SELECT schedule_mode FROM lt_recruitment WHERE event_id=NEW.event_id)='automatic';
 UPDATE lt_public_events SET dto=json_set(dto,'$.version',json_extract(dto,'$.version')+1,'$.schedule',json((SELECT blocks FROM lt_schedule WHERE event_id=NEW.event_id)),'$.endsAt',(SELECT json_extract(b.value,'$.endsAt') FROM lt_schedule s,json_each(s.blocks) b WHERE s.event_id=NEW.event_id ORDER BY CAST(b.key AS INTEGER) DESC LIMIT 1)) WHERE event_id=NEW.event_id;
 UPDATE lt_events SET version=version+1 WHERE id=NEW.event_id;
 INSERT INTO lt_outbox(id,operation_id,application_id,kind,recipient) VALUES(NEW.operation_id,NEW.operation_id,NEW.id,'approved',NEW.email);
 INSERT INTO lt_audit(id,operation_id,actor_id,action,application_id) VALUES(NEW.operation_id,NEW.operation_id,NEW.actor_id,'approved',NEW.id);
 -- 同じ承認操作の応答にも生成後の公開時刻を記録する
 UPDATE lt_operator_operations SET result=(SELECT json_set(a.dto,'$.operatorNote',a.operator_note) FROM lt_applications a WHERE a.id=NEW.id) WHERE actor=NEW.actor_id AND operation_id=NEW.operation_id;
END;



DROP TRIGGER lt_event_cancel;
CREATE TRIGGER lt_event_cancel AFTER UPDATE OF state ON lt_events
WHEN NEW.state='cancelled' AND OLD.state!='cancelled' AND NEW.cancel_operation IS NOT NULL
BEGIN
 INSERT INTO lt_outbox(id,operation_id,application_id,kind,recipient,expires) SELECT NEW.cancel_operation||':'||a.id,NEW.cancel_operation,a.id,'eventCancelled',a.email,(SELECT private_expires FROM lt_events WHERE id=NEW.id) FROM lt_applications a WHERE a.event_id=NEW.id AND a.active=1 AND json_extract(a.dto,'$.review') NOT IN ('rejected','withdrawn');
 INSERT INTO lt_event_cancellations SELECT NEW.cancel_actor,NEW.cancel_operation,NEW.id,NEW.cancel_hash,json_object('id',NEW.id,'version',NEW.version,'state','cancelled','title',json_extract(p.dto,'$.title'),'venue',json_extract(p.dto,'$.venue'),'guidance',json_extract(p.dto,'$.guidance'),'startsAt',json_extract(p.dto,'$.startsAt'),'timeZone',json_extract(p.dto,'$.timeZone'),'opensAt',strftime('%Y-%m-%dT%H:%M:%fZ',r.opens/1000.0,'unixepoch'),'closesAt',strftime('%Y-%m-%dT%H:%M:%fZ',r.closes/1000.0,'unixepoch'),'capacity',r.capacity,'talkMinutes',r.talk_minutes,'transitionMinutes',r.transition_minutes,'scheduleMode',r.schedule_mode,'openingMinutes',r.opening_minutes,'breakEvery',r.break_every,'breakMinutes',r.break_minutes,'closingMinutes',r.closing_minutes,'endsBy',r.ends_by,'approvalMode',r.approval_mode),e.private_expires FROM lt_events e JOIN lt_public_events p ON p.event_id=e.id JOIN lt_recruitment r ON r.event_id=e.id WHERE e.id=NEW.id;
END;

-- 発表時刻を同期した後の実体から承認応答を保存する
DROP TRIGGER lt_operator_receipt;
CREATE TRIGGER lt_operator_receipt AFTER UPDATE ON lt_applications
WHEN NEW.actor_id IS NOT NULL AND (NEW.operation_id!=OLD.operation_id OR NEW.actor_id IS NOT OLD.actor_id)
BEGIN
 INSERT INTO lt_operator_operations(actor,operation_id,application_id,payload_hash,result,expires) SELECT NEW.actor_id,NEW.operation_id,NEW.id,NEW.payload_hash,json_set(a.dto,'$.operatorNote',a.operator_note),(SELECT private_expires FROM lt_events WHERE id=NEW.event_id) FROM lt_applications a WHERE a.id=NEW.id;
 INSERT INTO lt_outbox(id,operation_id,application_id,kind,recipient,expires)
 SELECT NEW.operation_id||':'||NEW.id,NEW.operation_id,NEW.id,
 CASE WHEN json_extract(NEW.dto,'$.review')='returned' THEN 'returned' WHEN json_extract(NEW.dto,'$.review')='rejected' THEN 'rejected' WHEN json_extract(OLD.dto,'$.review')='resubmitted' AND json_extract(NEW.dto,'$.review')='approved' THEN 'reapproved' ELSE 'withdrawalConfirmed' END,NEW.email,(SELECT private_expires FROM lt_events WHERE id=NEW.event_id)
 WHERE json_extract(NEW.dto,'$.review') IN ('returned','rejected') OR (json_extract(OLD.dto,'$.review')='resubmitted' AND json_extract(NEW.dto,'$.review')='approved') OR (json_extract(OLD.dto,'$.withdrawal')='requested' AND json_extract(NEW.dto,'$.withdrawal')='confirmed');
END;
