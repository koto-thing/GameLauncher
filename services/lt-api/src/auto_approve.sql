-- 受付と同じトランザクション内で現在の末尾を読み、初回申請だけを承認する
UPDATE lt_applications AS a
SET dto=(
 SELECT json_set(a.dto,
  '$.version',a.version+1,'$.review','approved',
  '$.everApproved',json('true'),'$.slotReserved',json('true'),
  '$.published',json_set(json_extract(a.dto,'$.content'),
   '$.id',a.id,'$.eventId',a.event_id,'$.version',a.version+1,
   '$.startsAt',CASE WHEN json_extract(s.blocks,'$[#-1].kind')='closing'
    THEN json_extract(s.blocks,'$[#-1].startsAt')
    ELSE COALESCE(json_extract(s.blocks,'$[#-1].endsAt'),json_extract(p.dto,'$.startsAt')) END,
   '$.endsAt',strftime('%Y-%m-%dT%H:%M:%fZ',
    CASE WHEN json_extract(s.blocks,'$[#-1].kind')='closing'
     THEN json_extract(s.blocks,'$[#-1].startsAt')
     ELSE COALESCE(json_extract(s.blocks,'$[#-1].endsAt'),json_extract(p.dto,'$.startsAt')) END,
    '+'||r.talk_minutes||' minutes'),
   '$.cancelled',json('false')))
 FROM lt_recruitment r JOIN lt_schedule s ON s.event_id=r.event_id
 JOIN lt_public_events p ON p.event_id=r.event_id
 WHERE r.event_id=a.event_id
),version=version+1,actor_id='system:auto-approval',operation_id='auto-approval:'||id
WHERE id=?1 AND json_extract(dto,'$.everApproved')=0
 AND json_extract(dto,'$.review')='pending'
 AND json_extract(dto,'$.waitlisted') IS NOT 1
 AND EXISTS(SELECT 1 FROM lt_recruitment r WHERE r.event_id=a.event_id AND r.approval_mode='automatic');
