UPDATE lt_applications
SET version=version+1,
    dto=CASE WHEN json_type(dto,'$.published')='object'
        THEN json_set(dto,'$.content.title',?1,'$.content.abstract',?8,'$.version',version+1,'$.published.title',?1,'$.published.abstract',?8,'$.published.version',version+1)
        ELSE json_set(dto,'$.content.title',?1,'$.content.abstract',?8,'$.version',version+1) END,
    operation_id=?4,payload_hash=?5,actor_id=?6
WHERE id=?2 AND version=?3 AND (?7 IS NULL OR email=?7)
    AND json_extract(dto,'$.review') NOT IN ('rejected','withdrawn')
    AND json_extract(dto,'$.withdrawal')!='confirmed'
    AND (json_extract(dto,'$.retentionExpiresAt') IS NULL OR json_extract(dto,'$.retentionExpiresAt')>strftime('%Y-%m-%dT%H:%M:%fZ',(COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000))/1000.0,'unixepoch'))
    AND EXISTS(SELECT 1 FROM lt_events e WHERE e.id=lt_applications.event_id
        AND e.state IN ('scheduled','started','ended')
        AND (e.private_expires IS NULL OR e.private_expires>COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000)))
