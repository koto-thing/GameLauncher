import { ensureSchema, getD1 } from "@/db/initialize";
import type { SessionUser } from "@/lib/auth";
import {
  dispatchDeploymentWorkflow,
  githubAppDispatchConfigured,
  type DeploymentEnvironment,
} from "@/lib/github-app";

import {
  MAX_ARTIFACT_BYTES,
  MAX_ARTIFACT_FILES,
} from "@/lib/artifact-limits";

export { MAX_ARTIFACT_BYTES, MAX_ARTIFACT_FILES };

export type GrantType = "requester" | "approver" | "production_requester";

type Row = Record<string, unknown>;

function now(): string {
  return new Date().toISOString();
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function auditRecord(
  requestId: string | null,
  eventType: string,
  actor: SessionUser,
  payload: Record<string, unknown>,
) {
  const db = getD1();
  const scope = requestId ?? "__global__";
  const previous = await db.prepare(`SELECT sequence, event_hash
    FROM audit_events WHERE COALESCE(request_id, '__global__') = ?
    ORDER BY sequence DESC LIMIT 1`).bind(scope).first<{ sequence: number; event_hash: string }>();
  const sequence = (previous?.sequence ?? 0) + 1;
  const previousEventHash = previous?.event_hash ?? "0".repeat(64);
  const occurredAt = now();
  const payloadJson = stableJson(payload);
  const eventHash = await sha256(stableJson({
    requestId,
    sequence,
    eventType,
    actorGithubUserId: actor.githubUserId,
    occurredAt,
    payload: JSON.parse(payloadJson),
    previousEventHash,
  }));
  return db.prepare(`INSERT INTO audit_events
    (event_id, request_id, sequence, event_type, actor_github_user_id,
     actor_login_snapshot, occurred_at, payload_json, previous_event_hash, event_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      crypto.randomUUID(), requestId, sequence, eventType, actor.githubUserId,
      actor.login, occurredAt, payloadJson, previousEventHash, eventHash,
    );
}

async function activeGrant(userId: string, grantType: GrantType): Promise<boolean> {
  const row = await getD1().prepare(`SELECT 1 AS allowed FROM policy_grants
    WHERE github_user_id = ? AND grant_type = ? AND revoked_at IS NULL`)
    .bind(userId, grantType).first<{ allowed: number }>();
  return row?.allowed === 1;
}

export async function requireRequester(actor: SessionUser): Promise<void> {
  await ensureSchema();
  if (!actor.isAdmin && !await activeGrant(actor.githubUserId, "requester")) {
    throw new Error("申請者として許可されていません");
  }
}

async function requireProductionRequester(actor: SessionUser): Promise<void> {
  await ensureSchema();
  if (!actor.isAdmin && !await activeGrant(actor.githubUserId, "production_requester")) {
    throw new Error("Production申請者として許可されていません");
  }
}

async function requireAdmin(actor: SessionUser): Promise<void> {
  if (!actor.isAdmin) throw new Error("Adminだけが実行できます");
}

function validateGameId(value: string): string {
  const normalized = value.trim();
  if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(normalized)) {
    throw new Error("ゲームIDは3～64文字の英小文字・数字・ハイフンで入力してください");
  }
  return normalized;
}

function validateVersion(value: string): string {
  const normalized = value.trim();
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(normalized)) {
    throw new Error("バージョンは1.2.3形式で入力してください");
  }
  return normalized;
}

function validateSha256(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error("SHA-256は64桁の16進数です");
  return normalized;
}

async function requestRow(requestId: string): Promise<Row> {
  const row = await getD1().prepare("SELECT * FROM deployment_requests WHERE request_id = ?")
    .bind(requestId).first<Row>();
  if (!row) throw new Error("申請が見つかりません");
  return row;
}

export async function getDashboard(actor: SessionUser) {
  await ensureSchema();
  const db = getD1();
  const [canRequest, canApprove, canRequestProduction] = actor.isAdmin
    ? [true, false, true]
    : await Promise.all([
        activeGrant(actor.githubUserId, "requester"),
        activeGrant(actor.githubUserId, "approver"),
        activeGrant(actor.githubUserId, "production_requester"),
      ]);
  if (!actor.isAdmin && !canRequest && !canApprove && !canRequestProduction) {
    throw new Error("PandD control planeの利用をAdminから許可されていません");
  }
  const [usersResult, grantsResult, requestsResult, approversResult, decisionsResult, attemptsResult, eventsResult] =
    await Promise.all([
      db.prepare(`SELECT github_user_id, login_snapshot, avatar_url, is_admin, last_verified_at
        FROM users ORDER BY is_admin DESC, login_snapshot`).all<Row>(),
      db.prepare(`SELECT github_user_id, grant_type, granted_by_github_user_id, granted_at
        FROM policy_grants WHERE revoked_at IS NULL ORDER BY grant_type, github_user_id`).all<Row>(),
      db.prepare(`SELECT r.*, u.login_snapshot AS requester_login, a.size_bytes, a.file_count
        FROM deployment_requests r
        JOIN users u ON u.github_user_id = r.requester_github_user_id
        JOIN artifacts a ON a.artifact_id = r.artifact_id
        ORDER BY r.created_at DESC LIMIT 50`).all<Row>(),
      db.prepare(`SELECT ra.request_id, ra.approver_github_user_id, u.login_snapshot
        FROM request_approvers ra JOIN users u ON u.github_user_id = ra.approver_github_user_id`)
        .all<Row>(),
      db.prepare(`SELECT request_id, approver_github_user_id, decision, reason, decided_at
        FROM approval_decisions`).all<Row>(),
      db.prepare(`SELECT attempt_id, request_id, attempt_number, github_run_id, stage, result,
        started_at, finished_at, created_at FROM execution_attempts
        ORDER BY created_at DESC`).all<Row>(),
      db.prepare(`SELECT event_id, request_id, sequence, event_type, actor_login_snapshot,
        occurred_at, payload_json, event_hash FROM audit_events
        ORDER BY occurred_at DESC LIMIT 80`).all<Row>(),
    ]);

  const approvers = approversResult.results;
  const decisions = decisionsResult.results;
  const grants = grantsResult.results.map((row: Row) => ({
    githubUserId: asString(row.github_user_id),
    grantType: asString(row.grant_type),
    grantedAt: asString(row.granted_at),
  }));

  return {
    actor,
    system: {
      dispatchConfigured: {
        staging: githubAppDispatchConfigured("staging"),
        production: githubAppDispatchConfigured("production"),
      },
    },
    permissions: {
      canRequest,
      canApprove,
      canRequestProduction,
      canAdminister: actor.isAdmin,
    },
    users: usersResult.results.map((row: Row) => ({
      githubUserId: asString(row.github_user_id),
      login: asString(row.login_snapshot),
      avatarUrl: asString(row.avatar_url),
      isAdmin: asNumber(row.is_admin) === 1,
      grants: grants.filter((grant: { githubUserId: string; grantType: string }) => grant.githubUserId === asString(row.github_user_id))
        .map((grant: { githubUserId: string; grantType: string }) => grant.grantType),
    })),
    requests: requestsResult.results.map((row: Row) => ({
      requestId: asString(row.request_id),
      environment: asString(row.environment),
      artifactId: asString(row.artifact_id),
      artifactSha256: asString(row.artifact_sha256),
      gameId: asString(row.game_id),
      version: asString(row.version),
      requesterGithubUserId: asString(row.requester_github_user_id),
      requesterLogin: asString(row.requester_login),
      state: asString(row.state),
      createdAt: asString(row.created_at),
      submittedAt: row.submitted_at ? asString(row.submitted_at) : null,
      sourceStagingRequestId: row.source_staging_request_id ? asString(row.source_staging_request_id) : null,
      productionEligibleUntil: row.production_eligible_until ? asString(row.production_eligible_until) : null,
      productionEligible: Boolean(row.production_eligible_until &&
        Date.parse(asString(row.production_eligible_until)) > Date.now()),
      sizeBytes: asNumber(row.size_bytes),
      fileCount: asNumber(row.file_count),
      approvers: approvers.filter((item: Row) => item.request_id === row.request_id).map((item: Row) => ({
        githubUserId: asString(item.approver_github_user_id),
        login: asString(item.login_snapshot),
      })),
      decisions: decisions.filter((item: Row) => item.request_id === row.request_id).map((item: Row) => ({
        githubUserId: asString(item.approver_github_user_id),
        decision: asString(item.decision),
        reason: asString(item.reason),
        decidedAt: asString(item.decided_at),
      })),
      attempts: attemptsResult.results.filter((item: Row) => item.request_id === row.request_id)
        .map((item: Row) => ({
          attemptId: asString(item.attempt_id),
          attemptNumber: asNumber(item.attempt_number),
          githubRunId: item.github_run_id ? asString(item.github_run_id) : null,
          stage: asString(item.stage),
          result: asString(item.result),
          createdAt: asString(item.created_at),
          finishedAt: item.finished_at ? asString(item.finished_at) : null,
        })),
    })),
    events: eventsResult.results.map((row: Row) => ({
      eventId: asString(row.event_id),
      requestId: row.request_id ? asString(row.request_id) : null,
      sequence: asNumber(row.sequence),
      eventType: asString(row.event_type),
      actorLogin: asString(row.actor_login_snapshot),
      occurredAt: asString(row.occurred_at),
      payload: JSON.parse(asString(row.payload_json)),
      eventHash: asString(row.event_hash),
    })),
  };
}

export async function setGrant(
  actor: SessionUser,
  input: { githubUserId: string; login: string; grantType: GrantType; enabled: boolean },
) {
  await ensureSchema();
  await requireAdmin(actor);
  if (!(["requester", "approver", "production_requester"] as string[]).includes(input.grantType)) {
    throw new Error("権限種別が不正です");
  }
  const githubUserId = input.githubUserId.trim();
  const login = input.login.trim();
  if (!/^\d+$/.test(githubUserId)) throw new Error("GitHub user IDは数字で入力してください");
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(login)) {
    throw new Error("GitHubログイン名が不正です");
  }
  const timestamp = now();
  const db = getD1();
  const audit = await auditRecord(null, input.enabled ? "policy_grant_added" : "policy_grant_revoked", actor, {
    githubUserId,
    login,
    grantType: input.grantType,
  });
  await db.batch([
    db.prepare(`INSERT INTO users
      (github_user_id, login_snapshot, avatar_url, is_admin, last_verified_at)
      VALUES (?, ?, '', 0, ?)
      ON CONFLICT(github_user_id) DO UPDATE SET login_snapshot = excluded.login_snapshot`)
      .bind(githubUserId, login, timestamp),
    db.prepare(`INSERT INTO policy_grants
      (github_user_id, grant_type, granted_by_github_user_id, granted_at, revoked_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(github_user_id, grant_type) DO UPDATE SET
        granted_by_github_user_id = excluded.granted_by_github_user_id,
        granted_at = excluded.granted_at,
        revoked_at = excluded.revoked_at`)
      .bind(githubUserId, input.grantType, actor.githubUserId, timestamp, input.enabled ? null : timestamp),
    audit,
  ]);
}

export async function createRequest(actor: SessionUser, input: {
  artifactId: string;
  gameId: string;
  version: string;
  artifactSha256: string;
  sizeBytes: number;
  fileCount: number;
}) {
  await ensureSchema();
  await requireRequester(actor);
  const gameId = validateGameId(input.gameId);
  const version = validateVersion(input.version);
  const artifactSha256 = validateSha256(input.artifactSha256);
  const artifactId = input.artifactId.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(artifactId)) {
    throw new Error("artifact IDはuploaderが生成したUUIDである必要があります");
  }
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > MAX_ARTIFACT_BYTES) {
    throw new Error("artifact容量は1 byte以上5 GiB以下です");
  }
  if (!Number.isSafeInteger(input.fileCount) || input.fileCount <= 0 || input.fileCount > MAX_ARTIFACT_FILES) {
    throw new Error("ファイル数は1～50,000です");
  }
  const requestId = crypto.randomUUID();
  const timestamp = now();
  const metadata = { gameId, version, platform: "windows", arch: "x86_64" };
  const metadataJson = stableJson(metadata);
  const metadataSha256 = await sha256(metadataJson);
  const db = getD1();
  const artifact = await db.prepare(`SELECT a.size_bytes, a.file_count, a.claimed_sha256, a.status,
      u.game_id, u.version
    FROM artifacts a JOIN intake_uploads u ON u.artifact_id = a.artifact_id
    WHERE a.artifact_id = ?`).bind(artifactId).first<Row>();
  if (!artifact || artifact.status !== "sealed") {
    throw new Error("artifactはintake uploadとsealを完了している必要があります");
  }
  if (asNumber(artifact.size_bytes) !== input.sizeBytes ||
      asNumber(artifact.file_count) !== input.fileCount ||
      asString(artifact.claimed_sha256) !== artifactSha256 ||
      asString(artifact.game_id) !== gameId ||
      asString(artifact.version) !== version) {
    throw new Error("descriptorとsealed artifactの情報が一致しません");
  }
  const audit = await auditRecord(requestId, "request_created", actor, {
    environment: "staging",
    artifactId,
    artifactSha256,
    metadataSha256,
    sizeBytes: input.sizeBytes,
    fileCount: input.fileCount,
  });
  await db.batch([
    db.prepare(`INSERT INTO deployment_requests
      (request_id, environment, artifact_id, artifact_sha256, game_id, version,
       metadata_json, metadata_sha256, requester_github_user_id, state, created_at)
      VALUES (?, 'staging', ?, ?, ?, ?, ?, ?, ?, 'ready', ?)`)
      .bind(requestId, artifactId, artifactSha256, gameId, version, metadataJson,
        metadataSha256, actor.githubUserId, timestamp),
    audit,
  ]);
  return { requestId };
}

export async function createProductionRequest(
  actor: SessionUser,
  input: { sourceStagingRequestId: string },
) {
  await ensureSchema();
  await requireProductionRequester(actor);
  const source = await requestRow(input.sourceStagingRequestId);
  if (source.environment !== "staging" || source.state !== "succeeded") {
    throw new Error("成功済みのstaging申請だけをProductionへ進められます");
  }
  const eligibleUntil = asString(source.production_eligible_until);
  if (!eligibleUntil || Date.parse(eligibleUntil) <= Date.now()) {
    throw new Error("Production申請期限を過ぎています。stagingからやり直してください");
  }
  const artifact = await getD1().prepare(`SELECT claimed_sha256, status FROM artifacts
    WHERE artifact_id = ?`).bind(asString(source.artifact_id)).first<Row>();
  if (!artifact || artifact.status !== "sealed" ||
      asString(artifact.claimed_sha256) !== asString(source.artifact_sha256)) {
    throw new Error("stagingで検証したArtifactを確認できません");
  }
  const requestId = crypto.randomUUID();
  const timestamp = now();
  const audit = await auditRecord(requestId, "production_request_created", actor, {
    environment: "production",
    sourceStagingRequestId: input.sourceStagingRequestId,
    artifactId: asString(source.artifact_id),
    artifactSha256: asString(source.artifact_sha256),
    metadataSha256: asString(source.metadata_sha256),
    eligibleUntil,
  });
  await getD1().batch([
    getD1().prepare(`INSERT INTO deployment_requests
      (request_id, environment, artifact_id, artifact_sha256, game_id, version,
       metadata_json, metadata_sha256, requester_github_user_id, source_staging_request_id,
       state, created_at)
      VALUES (?, 'production', ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?)`)
      .bind(
        requestId,
        asString(source.artifact_id),
        asString(source.artifact_sha256),
        asString(source.game_id),
        asString(source.version),
        asString(source.metadata_json),
        asString(source.metadata_sha256),
        actor.githubUserId,
        input.sourceStagingRequestId,
        timestamp,
      ),
    audit,
  ]);
  return { requestId };
}

export async function designateApprover(
  actor: SessionUser,
  input: { requestId: string; approverGithubUserId: string },
) {
  await ensureSchema();
  await requireAdmin(actor);
  const request = await requestRow(input.requestId);
  if (request.state !== "ready") throw new Error("提出後は承認者を変更できません");
  if (request.requester_github_user_id === input.approverGithubUserId) {
    throw new Error("申請者本人を承認者にはできません");
  }
  if (!await activeGrant(input.approverGithubUserId, "approver")) {
    throw new Error("承認者allowlistに含まれていません");
  }
  const timestamp = now();
  const db = getD1();
  const audit = await auditRecord(input.requestId, "approver_designated", actor, {
    approverGithubUserId: input.approverGithubUserId,
  });
  await db.batch([
    db.prepare(`INSERT INTO request_approvers
      (request_id, approver_github_user_id, designated_by_github_user_id, designated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(request_id, approver_github_user_id) DO NOTHING`)
      .bind(input.requestId, input.approverGithubUserId, actor.githubUserId, timestamp),
    audit,
  ]);
}

export async function submitRequest(
  actor: SessionUser,
  input: { requestId: string; reason: string },
) {
  await ensureSchema();
  const request = await requestRow(input.requestId);
  if (request.requester_github_user_id !== actor.githubUserId) {
    throw new Error("申請者本人だけが提出できます");
  }
  if (request.state !== "ready") throw new Error("この申請は提出できません");
  const timestamp = now();
  const db = getD1();
  if (actor.isAdmin && request.environment === "staging") {
    const reason = input.reason.trim();
    if (reason.length < 3 || reason.length > 500) {
      throw new Error("Admin bypassの理由を3～500文字で入力してください");
    }
    const audit = await auditRecord(input.requestId, "admin_bypass", actor, { reason });
    await db.batch([
      db.prepare(`UPDATE deployment_requests SET state = 'approved', submitted_at = ?
        WHERE request_id = ? AND state = 'ready'`).bind(timestamp, input.requestId),
      audit,
    ]);
    return;
  }
  const requiredGrant = request.environment === "production" ? "production_requester" : "requester";
  if (!actor.isAdmin && !await activeGrant(actor.githubUserId, requiredGrant)) {
    throw new Error(`${request.environment}申請者allowlistから外れています`);
  }
  const approver = await db.prepare("SELECT 1 AS found FROM request_approvers WHERE request_id = ? LIMIT 1")
    .bind(input.requestId).first<{ found: number }>();
  if (!approver) throw new Error("Adminによる承認者指名が必要です");
  const audit = await auditRecord(input.requestId, "request_submitted", actor, {});
  await db.batch([
    db.prepare(`UPDATE deployment_requests SET state = 'pending_approval', submitted_at = ?
      WHERE request_id = ? AND state = 'ready'`).bind(timestamp, input.requestId),
    audit,
  ]);
}

export async function decideRequest(actor: SessionUser, input: {
  requestId: string;
  decision: "approved" | "rejected";
  reason: string;
}) {
  await ensureSchema();
  const request = await requestRow(input.requestId);
  if (request.state !== "pending_approval") throw new Error("承認待ちの申請ではありません");
  if (request.requester_github_user_id === actor.githubUserId) throw new Error("自己承認は禁止です");
  if (!await activeGrant(actor.githubUserId, "approver")) throw new Error("承認権限がありません");
  const designated = await getD1().prepare(`SELECT 1 AS found FROM request_approvers
    WHERE request_id = ? AND approver_github_user_id = ?`)
    .bind(input.requestId, actor.githubUserId).first<{ found: number }>();
  if (!designated) throw new Error("この申請の指名承認者ではありません");
  const existing = await getD1().prepare(`SELECT 1 AS found FROM approval_decisions
    WHERE request_id = ? AND approver_github_user_id = ?`)
    .bind(input.requestId, actor.githubUserId).first<{ found: number }>();
  if (existing) throw new Error("同じアカウントによる二重承認は禁止です");
  const reason = input.reason.trim();
  if (reason.length > 500) {
    throw new Error("承認・却下コメントは500文字以内で入力してください");
  }
  if (input.decision === "rejected" && reason.length < 3) {
    throw new Error("却下理由を3～500文字で入力してください");
  }
  const timestamp = now();
  const audit = await auditRecord(input.requestId,
    input.decision === "approved" ? "request_approved" : "request_rejected", actor, { reason });
  const db = getD1();
  await db.batch([
    db.prepare(`INSERT INTO approval_decisions
      (request_id, approver_github_user_id, decision, reason, decided_at)
      VALUES (?, ?, ?, ?, ?)`)
      .bind(input.requestId, actor.githubUserId, input.decision, reason, timestamp),
    db.prepare("UPDATE deployment_requests SET state = ? WHERE request_id = ? AND state = 'pending_approval'")
      .bind(input.decision, input.requestId),
    audit,
  ]);
}

export async function cancelRequest(actor: SessionUser, input: { requestId: string; reason: string }) {
  await ensureSchema();
  const request = await requestRow(input.requestId);
  if (!actor.isAdmin && request.requester_github_user_id !== actor.githubUserId) {
    throw new Error("申請者本人またはAdminだけがキャンセルできます");
  }
  if (!["ready", "pending_approval", "approved", "failed_retryable"].includes(asString(request.state))) {
    throw new Error("この状態の申請はキャンセルできません");
  }
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new Error("キャンセル理由を3～500文字で入力してください");
  }
  const audit = await auditRecord(input.requestId, "request_cancelled", actor, { reason });
  await getD1().batch([
    getD1().prepare(`UPDATE deployment_requests SET state = 'cancelled'
      WHERE request_id = ? AND state IN ('ready','pending_approval','approved','failed_retryable')`)
      .bind(input.requestId),
    audit,
  ]);
}

export async function authorizeRecovery(
  actor: SessionUser,
  input: { requestId: string; reason: string },
) {
  await ensureSchema();
  await requireAdmin(actor);
  const request = await requestRow(input.requestId);
  if (request.state !== "recovery_required") {
    throw new Error("復旧確認が必要な申請ではありません");
  }
  const reason = input.reason.trim();
  if (reason.length < 10 || reason.length > 500) {
    throw new Error("R2確認内容を10～500文字で入力してください");
  }
  const audit = await auditRecord(input.requestId, "recovery_retry_authorized", actor, { reason });
  await getD1().batch([
    getD1().prepare(`UPDATE deployment_requests SET state = 'failed_retryable'
      WHERE request_id = ? AND state = 'recovery_required'`).bind(input.requestId),
    audit,
  ]);
}

export async function dispatchRequest(actor: SessionUser, input: { requestId: string }) {
  await ensureSchema();
  const request = await requestRow(input.requestId);
  const environment = asString(request.environment) as DeploymentEnvironment;
  if (environment !== "staging" && environment !== "production") {
    throw new Error("公開環境が不正です");
  }
  if (!githubAppDispatchConfigured(environment)) {
    throw new Error(`${environment} Actions設定がまだ完了していません`);
  }
  if (request.state !== "approved" && request.state !== "failed_retryable") {
    throw new Error("実行承認済みの申請ではありません");
  }
  if (!actor.isAdmin && request.requester_github_user_id !== actor.githubUserId) {
    throw new Error("申請者本人またはAdminだけが実行できます");
  }
  if (environment === "production") {
    await requireProductionRequester(actor);
    const source = await requestRow(asString(request.source_staging_request_id));
    if (source.environment !== "staging" || source.state !== "succeeded" ||
        asString(source.artifact_id) !== asString(request.artifact_id) ||
        asString(source.artifact_sha256) !== asString(request.artifact_sha256) ||
        !source.production_eligible_until ||
        Date.parse(asString(source.production_eligible_until)) <= Date.now()) {
      throw new Error("Production実行条件を満たすstaging申請を確認できません");
    }
  } else {
    await requireRequester(actor);
  }
  const db = getD1();
  const last = await db.prepare(`SELECT COALESCE(MAX(attempt_number), 0) AS attempt_number
    FROM execution_attempts WHERE request_id = ?`).bind(input.requestId)
    .first<{ attempt_number: number }>();
  const attemptNumber = (last?.attempt_number ?? 0) + 1;
  const attemptId = crypto.randomUUID();
  const timestamp = now();
  const audit = await auditRecord(input.requestId, "workflow_dispatch_requested", actor, {
    attemptId,
    attemptNumber,
    environment,
    artifactSha256: asString(request.artifact_sha256),
  });
  const transition = await db.prepare(`UPDATE deployment_requests SET state = 'dispatched'
    WHERE request_id = ? AND state IN ('approved','failed_retryable')`)
    .bind(input.requestId).run();
  if (asNumber(transition.meta.changes) !== 1) throw new Error("別の実行要求が進行中です");
  try {
    await db.batch([
      db.prepare(`INSERT INTO execution_attempts
        (attempt_id, request_id, attempt_number, stage, result, created_at)
        VALUES (?, ?, ?, 'dispatching', 'queued', ?)`)
        .bind(attemptId, input.requestId, attemptNumber, timestamp),
      audit,
    ]);
  } catch (error) {
    await db.prepare("UPDATE deployment_requests SET state = ? WHERE request_id = ? AND state = 'dispatched'")
      .bind(asString(request.state), input.requestId).run();
    throw error;
  }
  try {
    await dispatchDeploymentWorkflow(environment, input.requestId, attemptId);
  } catch (error) {
    await db.batch([
      db.prepare(`UPDATE execution_attempts SET stage = 'dispatch', result = 'failed', finished_at = ?
        WHERE attempt_id = ?`).bind(now(), attemptId),
      db.prepare("UPDATE deployment_requests SET state = 'failed_retryable' WHERE request_id = ?")
        .bind(input.requestId),
    ]);
    throw error;
  }
  // workflow_dispatch does not return a run ID. Keep the attempt in
  // `dispatching` until the OIDC-authenticated preflight binds the real run.
  // Never make it retryable after the external dispatch has succeeded: doing
  // so could start the same deployment twice.
  return { attemptId };
}

export async function listSuccessfulStagingRequests() {
  await ensureSchema();
  return getD1().prepare(`SELECT request_id, artifact_id, artifact_sha256, game_id, version,
    production_eligible_until FROM deployment_requests
    WHERE environment = 'staging' AND state = 'succeeded'
      AND production_eligible_until > ? ORDER BY created_at DESC`)
    .bind(now()).all<Row>();
}
