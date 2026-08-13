CREATE UNIQUE INDEX `idx_audit_events_scope_sequence`
ON `audit_events` (coalesce(`request_id`, '__global__'), `sequence`);
