import { env } from "cloudflare:workers";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { ensureSchema, getD1 } from "@/db/initialize";
import { auditRecord } from "@/lib/control-plane";
import { issueArtifactDownloadUrl } from "@/lib/intake";
import type { SessionUser } from "@/lib/auth";

const OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const OIDC_AUDIENCE = "pandd-control-plane";
const REPOSITORY = "koto-thing/GameLauncher";
const WORKFLOW_ENVIRONMENTS = new Map<string, "staging" | "production">([
  ["koto-thing/GameLauncher/.github/workflows/deploy-game-staging.yml@refs/heads/master", "staging"],
  ["koto-thing/GameLauncher/.github/workflows/deploy-game-production.yml@refs/heads/master", "production"],
] as const);
const jwks = createRemoteJWKSet(new URL(`${OIDC_ISSUER}/.well-known/jwks`));

type ActionsEnv = { GITHUB_REPOSITORY_ID?: string };
type Row = Record<string, unknown>;

export type ActionsIdentity = {
  runId: string;
  runAttempt: number;
  workflowSha: string;
  deploymentEnvironment: "staging" | "production";
  environment?: string;
  claims: JWTPayload;
};

function text(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function number(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

export async function requireActionsIdentity(
  request: Request,
  requireEnvironment: boolean,
): Promise<ActionsIdentity> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) throw new Response("OIDC token required", { status: 401 });
  const repositoryId = (env as unknown as ActionsEnv).GITHUB_REPOSITORY_ID;
  if (!repositoryId) throw new Error("GITHUB_REPOSITORY_IDが設定されていません");
  const { payload } = await jwtVerify(authorization.slice("Bearer ".length), jwks, {
    issuer: OIDC_ISSUER,
    audience: OIDC_AUDIENCE,
  });
  const deploymentEnvironment = WORKFLOW_ENVIRONMENTS.get(text(payload.workflow_ref));
  if (payload.repository !== REPOSITORY || payload.repository_id !== repositoryId ||
      payload.repository_visibility !== "public" || payload.event_name !== "workflow_dispatch" ||
      !deploymentEnvironment || payload.ref !== "refs/heads/master") {
    throw new Response("OIDC claims rejected", { status: 403 });
  }
  if (requireEnvironment && payload.environment !== deploymentEnvironment) {
    throw new Response(`${deploymentEnvironment} Environment claim required`, { status: 403 });
  }
  const runId = text(payload.run_id);
  const runAttempt = number(payload.run_attempt);
  const workflowSha = text(payload.workflow_sha);
  if (!/^\d+$/.test(runId) || !Number.isSafeInteger(runAttempt) || runAttempt < 1 ||
      !/^[0-9a-f]{40}$/.test(workflowSha)) {
    throw new Response("OIDC run claims rejected", { status: 403 });
  }
  return {
    runId,
    runAttempt,
    workflowSha,
    deploymentEnvironment,
    environment: typeof payload.environment === "string" ? payload.environment : undefined,
    claims: payload,
  };
}

function actionsActor(identity: ActionsIdentity): SessionUser {
  return {
    githubUserId: text(identity.claims.actor_id),
    login: text(identity.claims.actor),
    avatarUrl: "",
    isAdmin: false,
    authenticatedAt: new Date().toISOString(),
    authSource: "github",
  };
}

export async function preflightRequest(
  identity: ActionsIdentity,
  input: { requestId: string; attemptId: string },
) {
  await ensureSchema();
  const db = getD1();
  const row = await db.prepare(`SELECT r.*, a.intake_object_key, a.size_bytes, a.file_count,
      a.claimed_sha256, a.status AS artifact_status, u.is_admin AS requester_is_admin,
      e.request_id AS attempt_request_id, e.github_run_id, e.result AS attempt_result
    FROM deployment_requests r
    JOIN artifacts a ON a.artifact_id = r.artifact_id
    JOIN users u ON u.github_user_id = r.requester_github_user_id
    JOIN execution_attempts e ON e.attempt_id = ?
    WHERE r.request_id = ?`)
    .bind(input.attemptId, input.requestId).first<Row>();
  if (!row || text(row.attempt_request_id) !== input.requestId) throw new Error("requestまたはattemptが見つかりません");
  if (row.environment !== identity.deploymentEnvironment ||
      !["dispatched", "running"].includes(text(row.state)) ||
      row.artifact_status !== "sealed" || row.attempt_result !== "queued") {
    throw new Error("requestはこのworkflowで実行可能な状態ではありません");
  }
  if (row.github_run_id && text(row.github_run_id) !== identity.runId) {
    throw new Error("attemptは別のGitHub runへ固定されています");
  }
  if (identity.deploymentEnvironment === "production") {
    const source = await db.prepare(`SELECT request_id, artifact_id, artifact_sha256, state,
      production_eligible_until FROM deployment_requests WHERE request_id = ?`)
      .bind(text(row.source_staging_request_id)).first<Row>();
    if (!source || source.state !== "succeeded" ||
        text(source.artifact_id) !== text(row.artifact_id) ||
        text(source.artifact_sha256) !== text(row.artifact_sha256) ||
        Date.parse(text(source.production_eligible_until)) <= Date.now()) {
      throw new Error("有効なstaging成功記録を確認できません");
    }
    if (number(row.requester_is_admin) !== 1) {
      const requesterGrant = await db.prepare(`SELECT 1 AS allowed FROM policy_grants
        WHERE github_user_id = ? AND grant_type = 'production_requester' AND revoked_at IS NULL`)
        .bind(text(row.requester_github_user_id)).first<{ allowed: number }>();
      if (!requesterGrant) throw new Error("production requester grantが現在有効ではありません");
    }
    const approval = await db.prepare(`SELECT 1 AS allowed
      FROM approval_decisions d
      JOIN request_approvers ra ON ra.request_id = d.request_id
        AND ra.approver_github_user_id = d.approver_github_user_id
      JOIN policy_grants g ON g.github_user_id = d.approver_github_user_id
        AND g.grant_type = 'approver' AND g.revoked_at IS NULL
      WHERE d.request_id = ? AND d.decision = 'approved'
        AND d.approver_github_user_id != ? LIMIT 1`)
      .bind(input.requestId, text(row.requester_github_user_id)).first<{ allowed: number }>();
    if (!approval) throw new Error("Production用の有効な指名承認を確認できません");
  } else if (number(row.requester_is_admin) === 1) {
    const bypass = await db.prepare(`SELECT 1 AS found FROM audit_events
      WHERE request_id = ? AND event_type = 'admin_bypass' LIMIT 1`)
      .bind(input.requestId).first<{ found: number }>();
    if (!bypass) throw new Error("Admin bypass監査記録が見つかりません");
  } else {
    const requesterGrant = await db.prepare(`SELECT 1 AS allowed FROM policy_grants
      WHERE github_user_id = ? AND grant_type = 'requester' AND revoked_at IS NULL`)
      .bind(text(row.requester_github_user_id)).first<{ allowed: number }>();
    if (!requesterGrant) throw new Error("requester grantが現在有効ではありません");
    const approval = await db.prepare(`SELECT 1 AS allowed
      FROM approval_decisions d
      JOIN request_approvers ra ON ra.request_id = d.request_id
        AND ra.approver_github_user_id = d.approver_github_user_id
      JOIN policy_grants g ON g.github_user_id = d.approver_github_user_id
        AND g.grant_type = 'approver' AND g.revoked_at IS NULL
      WHERE d.request_id = ? AND d.decision = 'approved'
        AND d.approver_github_user_id != ? LIMIT 1`)
      .bind(input.requestId, text(row.requester_github_user_id)).first<{ allowed: number }>();
    if (!approval) throw new Error("有効な指名承認を確認できません");
  }
  const timestamp = new Date().toISOString();
  const audit = await auditRecord(input.requestId, "actions_preflight_passed", actionsActor(identity), {
    attemptId: input.attemptId,
    runId: identity.runId,
    runAttempt: identity.runAttempt,
    workflowCommitSha: identity.workflowSha,
    environment: identity.deploymentEnvironment,
    artifactSha256: text(row.artifact_sha256),
  });
  await db.batch([
    db.prepare(`UPDATE execution_attempts SET github_run_id = ?, github_run_attempt = ?,
      workflow_commit_sha = ?, stage = 'preflight', started_at = COALESCE(started_at, ?)
      WHERE attempt_id = ? AND result = 'queued'`)
      .bind(identity.runId, identity.runAttempt, identity.workflowSha, timestamp, input.attemptId),
    db.prepare("UPDATE deployment_requests SET state = 'running' WHERE request_id = ? AND state = 'dispatched'")
      .bind(input.requestId),
    audit,
  ]);
  return {
    requestId: input.requestId,
    attemptId: input.attemptId,
    environment: identity.deploymentEnvironment,
    artifact: {
      id: text(row.artifact_id),
      sha256: text(row.artifact_sha256),
      sizeBytes: number(row.size_bytes),
      fileCount: number(row.file_count),
      downloadUrl: await issueArtifactDownloadUrl(text(row.artifact_id)),
    },
    metadata: JSON.parse(text(row.metadata_json)),
  };
}

export async function recordPreflightRejection(
  identity: ActionsIdentity,
  input: { requestId: string; attemptId: string },
) {
  await ensureSchema();
  const db = getD1();
  const attempt = await db.prepare(`SELECT e.request_id, e.result, r.environment
    FROM execution_attempts e JOIN deployment_requests r ON r.request_id = e.request_id
    WHERE e.attempt_id = ?`).bind(input.attemptId).first<Row>();
  if (!attempt || text(attempt.request_id) !== input.requestId || attempt.result !== "queued" ||
      attempt.environment !== identity.deploymentEnvironment) return;
  const timestamp = new Date().toISOString();
  const audit = await auditRecord(input.requestId, "actions_preflight_rejected", actionsActor(identity), {
    attemptId: input.attemptId,
    runId: identity.runId,
    runAttempt: identity.runAttempt,
    workflowCommitSha: identity.workflowSha,
    environment: identity.deploymentEnvironment,
  });
  await db.batch([
    db.prepare(`UPDATE execution_attempts SET github_run_id = ?, github_run_attempt = ?,
      workflow_commit_sha = ?, stage = 'preflight', result = 'failed_terminal',
      started_at = ?, finished_at = ? WHERE attempt_id = ? AND result = 'queued'`)
      .bind(
        identity.runId, identity.runAttempt, identity.workflowSha,
        timestamp, timestamp, input.attemptId,
      ),
    db.prepare("UPDATE deployment_requests SET state = 'failed_terminal' WHERE request_id = ?")
      .bind(input.requestId),
    audit,
  ]);
}

const stages = new Set(["building", "uploading_immutable", "publishing_pointers", "verifying"]);
const terminalResults = new Set(["succeeded", "failed_retryable", "failed_terminal", "recovery_required"]);

export async function recordActionsStatus(identity: ActionsIdentity, input: {
  requestId: string;
  attemptId: string;
  stage: string;
  result?: string;
  manifestSha256?: string;
  publishedObjectCount?: number;
}) {
  await ensureSchema();
  const db = getD1();
  const attempt = await db.prepare(`SELECT e.request_id, e.github_run_id, e.github_run_attempt,
    e.result, r.environment FROM execution_attempts e
    JOIN deployment_requests r ON r.request_id = e.request_id
    WHERE e.attempt_id = ?`).bind(input.attemptId).first<Row>();
  const mayBindPreflightFailure = input.stage === "preflight" && attempt && !attempt.github_run_id;
  if (!attempt || text(attempt.request_id) !== input.requestId || attempt.result !== "queued" ||
      attempt.environment !== identity.deploymentEnvironment ||
      (!mayBindPreflightFailure && (text(attempt.github_run_id) !== identity.runId ||
        number(attempt.github_run_attempt) !== identity.runAttempt))) {
    throw new Error("Actions callbackがattemptと一致しません");
  }
  const result = input.result?.trim() || "running";
  if (!stages.has(input.stage) && !terminalResults.has(result)) throw new Error("実行stageが不正です");
  if (input.manifestSha256 && !/^[0-9a-f]{64}$/.test(input.manifestSha256)) {
    throw new Error("manifest SHA-256が不正です");
  }
  const terminal = terminalResults.has(result);
  const timestamp = new Date().toISOString();
  const actor = actionsActor(identity);
  const audit = await auditRecord(input.requestId, terminal ? "execution_finished" : "execution_stage", actor, {
    attemptId: input.attemptId,
    runId: identity.runId,
    stage: input.stage,
    result,
    environment: identity.deploymentEnvironment,
    ...(input.manifestSha256 ? { manifestSha256: input.manifestSha256 } : {}),
    ...(Number.isSafeInteger(input.publishedObjectCount) ?
      { publishedObjectCount: input.publishedObjectCount } : {}),
  });
  await db.batch([
    ...(mayBindPreflightFailure ? [
      db.prepare(`UPDATE execution_attempts SET github_run_id = ?, github_run_attempt = ?,
        workflow_commit_sha = ?, started_at = COALESCE(started_at, ?) WHERE attempt_id = ?`)
        .bind(identity.runId, identity.runAttempt, identity.workflowSha, timestamp, input.attemptId),
    ] : []),
    db.prepare(`UPDATE execution_attempts SET stage = ?, result = ?, finished_at = ?
      WHERE attempt_id = ? AND result = 'queued'`)
      .bind(input.stage, terminal ? result : "queued", terminal ? timestamp : null, input.attemptId),
    db.prepare("UPDATE deployment_requests SET state = ? WHERE request_id = ?")
      .bind(
        terminal ? result : (["publishing_pointers", "verifying"].includes(input.stage) ?
          input.stage : "running"),
        input.requestId,
      ),
    ...(terminal && result === "succeeded" && identity.deploymentEnvironment === "staging" ? [
      db.prepare(`UPDATE deployment_requests SET production_eligible_until = ?
        WHERE request_id = ? AND environment = 'staging'`)
        .bind(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), input.requestId),
    ] : []),
    audit,
  ]);
}
