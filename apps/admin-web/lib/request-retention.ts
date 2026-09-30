// 完了後も更新された申請と他の申請の参照元を保護し、365日経過した申請だけを対象にする
const expiredRequests = `SELECT r.request_id FROM deployment_requests r
  WHERE r.created_at < ?
    AND r.state IN ('succeeded', 'rejected', 'cancelled', 'failed_terminal')
    AND NOT EXISTS (SELECT 1 FROM audit_events e
      WHERE e.request_id = r.request_id AND e.occurred_at >= ?)
    AND NOT EXISTS (SELECT 1 FROM execution_attempts a
      WHERE a.request_id = r.request_id
        AND COALESCE(a.finished_at, a.started_at, a.created_at) >= ?)
    AND NOT EXISTS (SELECT 1 FROM deployment_requests dependent
      WHERE dependent.source_staging_request_id = r.request_id)`;

// 申請履歴と関連ログを外部キー順に同一トランザクションで削除する
export async function pruneRequestHistory(db: D1Database, timestamp: number): Promise<void> {
  const cutoff = new Date(timestamp - 365 * 24 * 60 * 60 * 1000).toISOString();
  const tables = ["request_approvers", "approval_decisions", "execution_attempts", "audit_events", "deployment_requests"];

  await db.batch(tables.map((table) => db.prepare(
    `DELETE FROM ${table} WHERE request_id IN (${expiredRequests})`,
  ).bind(cutoff, cutoff, cutoff)));
}
