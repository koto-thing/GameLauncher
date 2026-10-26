UPDATE lt_events SET publish_enabled=0 WHERE id IN (SELECT id FROM lt_event_configs WHERE source_id IS NOT NULL AND expected_version=0);
