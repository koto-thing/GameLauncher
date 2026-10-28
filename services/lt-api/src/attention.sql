WITH eligible AS (
 SELECT a.id,a.event_id,a.dto,c.dto AS config,r.capacity,r.reserved,
        json_extract(c.dto,'$.title') AS title,
        unixepoch(json_extract(c.dto,'$.startsAt'),'subsec')*1000
         -json_extract(c.dto,'$.planning.materialDaysBefore')*86400000 AS deadline
 FROM lt_applications a
 JOIN lt_events e ON e.id=a.event_id
 JOIN lt_event_configs c ON c.id=e.id
 JOIN lt_recruitment r ON r.event_id=e.id
 WHERE e.publish_enabled=1 AND e.state IN ('scheduled','started') AND a.active=1
  AND (e.private_expires IS NULL OR e.private_expires>?1)
  AND json_extract(a.dto,'$.review') NOT IN ('rejected','withdrawn')
  AND json_extract(a.dto,'$.withdrawal')!='confirmed'
), items AS (
 SELECT 'withdrawal:'||id AS key,event_id,title,id AS application_id,'withdrawal' AS reason
 FROM eligible WHERE json_extract(dto,'$.withdrawal')='requested'
 UNION ALL
 SELECT 'vacancy:'||event_id,event_id,title,NULL,'vacancy'
 FROM eligible WHERE json_extract(dto,'$.waitlisted')=1 AND reserved<capacity
  AND json_extract(dto,'$.withdrawal')='none'
  AND unixepoch(json_extract(config,'$.startsAt'),'subsec')*1000>?1
 GROUP BY event_id
 UNION ALL
 SELECT 'material:'||id||':'||CAST(deadline AS INTEGER),event_id,title,id,'material'
 FROM eligible WHERE deadline<=?1 AND json_extract(dto,'$.withdrawal')='none'
  AND COALESCE(json_extract(dto,'$.waitlisted'),0)=0
  AND (COALESCE(json_extract(dto,'$.materialUrl'),'')=''
   OR COALESCE(json_extract(dto,'$.materialReviewedUrl'),'')!=json_extract(dto,'$.materialUrl'))
)
SELECT key,event_id AS eventId,title,application_id AS applicationId,reason FROM items ORDER BY key
