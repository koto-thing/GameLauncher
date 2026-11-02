-- 公開済み発表に、保持期限内かつ承認済みの現在の資料だけを添える
SELECT p.dto,
       (SELECT json_extract(a.dto, '$.materialUrl')
          FROM lt_applications a
         WHERE a.id = p.id AND a.event_id = p.event_id
           AND json_extract(a.dto, '$.review') = 'approved'
           AND json_extract(a.dto, '$.withdrawal') = 'none'
           AND json_extract(p.dto, '$.cancelled') = 0
           AND (e.private_expires IS NULL OR e.private_expires > COALESCE((SELECT now_ms FROM lt_clock WHERE id=1), unixepoch('subsec')*1000))
           AND (json_extract(a.dto, '$.retentionExpiresAt') IS NULL OR json_extract(a.dto, '$.retentionExpiresAt') > strftime('%Y-%m-%dT%H:%M:%fZ', COALESCE((SELECT now_ms FROM lt_clock WHERE id=1), unixepoch('subsec')*1000)/1000.0, 'unixepoch'))
       ) AS material_url
  FROM lt_public_talks p JOIN lt_events e ON e.id=p.event_id
 WHERE p.approval_operation IS NOT NULL
   AND (p.approval_operation!='lt-archive:v1' OR EXISTS(SELECT 1 FROM lt_archive_markers m WHERE m.talk_id=p.id AND m.event_id=p.event_id AND json(m.snapshot_json)=json(p.dto)))
   AND e.publish_enabled=1 AND e.state IN ('scheduled','started','ended')
   AND e.public_opens_at <= CAST(COALESCE((SELECT now_ms FROM lt_clock WHERE id=1),unixepoch('subsec')*1000) AS INTEGER)
   AND e.id=?1 AND p.id=?2
