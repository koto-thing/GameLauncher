// 完了後も更新された申請と他の申請の参照元を保護する
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

// 365日経過した申請と関連ログを外部キー順に同一トランザクションで削除する
export async function pruneRequestHistory(db: D1Database, timestamp: number): Promise<void> {
  const cutoff = new Date(timestamp - 365 * 24 * 60 * 60 * 1000).toISOString();
  const tables = ["publication_recoveries", "request_approvers", "approval_decisions", "execution_attempts", "audit_events", "deployment_requests"];

  await db.batch(tables.map((table) => db.prepare(
    `DELETE FROM ${table} WHERE request_id IN (${expiredRequests})`,
  ).bind(cutoff, cutoff, cutoff)));
}

// 未承認の保存期限でCronから削除せず、dry-runも候補100件までに制限する
export async function scheduledRequestRetention(db: D1Database, timestamp: number, mode?: string) {
  if (mode !== "dry-run") return { mode: "disabled" };

  const cutoff = new Date(timestamp - 365 * 86400000).toISOString();
  const sample = expiredRequests.replace("FROM deployment_requests r", "FROM (SELECT * FROM deployment_requests WHERE created_at < ? ORDER BY created_at LIMIT 100) r");
  const result = await db.prepare(`SELECT COUNT(*) AS count FROM (${sample})`)
    .bind(cutoff, cutoff, cutoff, cutoff).first<{ count: number }>();

  return { mode: "dry-run", cutoff, candidateRequestsInSample: result?.count ?? 0, sampleLimit: 100 };
}
