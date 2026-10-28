import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// Control PlaneとIntakeの永続化モデル。各テーブルはdb/initialize.tsのDDLと対応する
export const physicalEditions = sqliteTable("physical_editions", {
  editionId: text("edition_id").primaryKey(),
  definitionJson: text("definition_json").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
});

// 固定配布版に対する各ビルドとOIDC実行主体の記録
export const physicalEditionBuilds = sqliteTable("physical_edition_builds", {
  buildId: text("build_id").primaryKey(),
  editionId: text("edition_id").notNull().references(() => physicalEditions.editionId),
  state: text("state").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  runId: text("run_id"),
  runAttempt: integer("run_attempt"),
  workflowSha: text("workflow_sha"),
  snapshotJson: text("snapshot_json"),
  artifactId: text("artifact_id"),
  error: text("error"),
  finishedAt: text("finished_at"),
}, (table) => [index("physical_edition_builds_edition").on(table.editionId, table.createdAt)]);

export const users = sqliteTable("users", {
  githubUserId: text("github_user_id").primaryKey(),
  loginSnapshot: text("login_snapshot").notNull(),
  avatarUrl: text("avatar_url").notNull().default(""),
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
  lastVerifiedAt: text("last_verified_at").notNull(),
});

export const policyGrants = sqliteTable(
  "policy_grants",
  {
    githubUserId: text("github_user_id").notNull(),
    grantType: text("grant_type", {
      enum: ["requester", "approver", "production_requester"],
    }).notNull(),
    grantedByGithubUserId: text("granted_by_github_user_id").notNull(),
    grantedAt: text("granted_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    primaryKey({ columns: [table.githubUserId, table.grantType] }),
    index("idx_policy_grants_active").on(table.grantType, table.revokedAt),
  ],
);

// 本人が提出した利用申請と審査結果を保存し、権限は既存のサービス別テーブルに置く
export const accessRequests = sqliteTable("access_requests", {
  id: text("id").primaryKey(),
  applicantId: text("applicant_id").notNull().references(() => users.githubUserId),
  service: text("service", { enum: ["game", "music"] }).notNull(),
  target: text("target").notNull(),
  displayName: text("display_name").notNull(),
  purpose: text("purpose").notNull(),
  state: text("state", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
  createdAt: text("created_at").notNull(),
  decidedAt: text("decided_at"),
  decidedBy: text("decided_by").references(() => users.githubUserId),
  reason: text("reason").notNull().default(""),
  grantType: text("grant_type"),
  gameId: text("game_id"),
  decisionToken: text("decision_token"),
  repositoryAccess: integer("repository_access").notNull().default(0),
}, (table) => [
  uniqueIndex("access_requests_pending").on(table.applicantId, table.service, table.target).where(sql`${table.state}='pending'`),
  index("access_requests_review").on(table.service, table.state, table.createdAt),
  index("access_requests_applicant").on(table.applicantId, table.createdAt),
]);

export const artifacts = sqliteTable("artifacts", {
  artifactId: text("artifact_id").primaryKey(),
  intakeObjectKey: text("intake_object_key").notNull().unique(),
  sizeBytes: integer("size_bytes").notNull(),
  fileCount: integer("file_count").notNull(),
  claimedSha256: text("claimed_sha256").notNull(),
  status: text("status", { enum: ["sealed"] }).notNull(),
  sealedAt: text("sealed_at").notNull(),
});

export const intakeUploads = sqliteTable(
  "intake_uploads",
  {
    artifactId: text("artifact_id").primaryKey(),
    intakeObjectKey: text("intake_object_key").notNull().unique(),
    multipartUploadId: text("multipart_upload_id").notNull(),
    requesterGithubUserId: text("requester_github_user_id").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    fileCount: integer("file_count").notNull(),
    claimedSha256: text("claimed_sha256").notNull(),
    gameId: text("game_id").notNull(),
    version: text("version").notNull(),
    partSize: integer("part_size").notNull(),
    partCount: integer("part_count").notNull(),
    state: text("state", { enum: ["uploading", "sealing", "sealed", "cancelled"] }).notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    index("idx_intake_uploads_requester_state").on(table.requesterGithubUserId, table.state),
    index("idx_intake_uploads_expires").on(table.expiresAt),
  ],
);

export const intakeUploadParts = sqliteTable(
  "intake_upload_parts",
  {
    artifactId: text("artifact_id").notNull(),
    partNumber: integer("part_number").notNull(),
    etag: text("etag").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    recordedAt: text("recorded_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.artifactId, table.partNumber] })],
);

export const deploymentRequests = sqliteTable(
  "deployment_requests",
  {
    requestId: text("request_id").primaryKey(),
    environment: text("environment", { enum: ["staging", "production"] }).notNull(),
    artifactId: text("artifact_id").notNull(),
    artifactSha256: text("artifact_sha256").notNull(),
    gameId: text("game_id").notNull(),
    version: text("version").notNull(),
    metadataJson: text("metadata_json").notNull(),
    metadataSha256: text("metadata_sha256").notNull(),
    requesterGithubUserId: text("requester_github_user_id").notNull(),
    sourceStagingRequestId: text("source_staging_request_id"),
    state: text("state").notNull(),
    createdAt: text("created_at").notNull(),
    submittedAt: text("submitted_at"),
    productionEligibleUntil: text("production_eligible_until"),
  },
  (table) => [
    index("idx_deployment_requests_created").on(table.createdAt),
    index("idx_deployment_requests_state").on(table.state),
    uniqueIndex("idx_deployment_requests_environment_game_version").on(
      table.environment,
      table.gameId,
      table.version,
    ),
  ],
);

export const requestApprovers = sqliteTable(
  "request_approvers",
  {
    requestId: text("request_id").notNull(),
    approverGithubUserId: text("approver_github_user_id").notNull(),
    designatedByGithubUserId: text("designated_by_github_user_id").notNull(),
    designatedAt: text("designated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.requestId, table.approverGithubUserId] })],
);

export const approvalDecisions = sqliteTable(
  "approval_decisions",
  {
    requestId: text("request_id").notNull(),
    approverGithubUserId: text("approver_github_user_id").notNull(),
    decision: text("decision", { enum: ["approved", "rejected"] }).notNull(),
    reason: text("reason").notNull().default(""),
    decidedAt: text("decided_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.requestId, table.approverGithubUserId] })],
);

export const executionAttempts = sqliteTable(
  "execution_attempts",
  {
    attemptId: text("attempt_id").primaryKey(),
    requestId: text("request_id").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    githubRunId: text("github_run_id"),
    githubRunAttempt: integer("github_run_attempt"),
    workflowCommitSha: text("workflow_commit_sha"),
    stage: text("stage").notNull(),
    result: text("result").notNull(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_execution_attempts_request_number").on(table.requestId, table.attemptNumber),
    uniqueIndex("idx_execution_attempts_github_run").on(table.githubRunId, table.githubRunAttempt),
  ],
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    eventId: text("event_id").primaryKey(),
    requestId: text("request_id"),
    sequence: integer("sequence").notNull(),
    eventType: text("event_type").notNull(),
    actorGithubUserId: text("actor_github_user_id"),
    actorLoginSnapshot: text("actor_login_snapshot"),
    occurredAt: text("occurred_at").notNull(),
    payloadJson: text("payload_json").notNull(),
    previousEventHash: text("previous_event_hash").notNull(),
    eventHash: text("event_hash").notNull(),
  },
  (table) => [
    uniqueIndex("idx_audit_events_request_sequence").on(table.requestId, table.sequence),
    uniqueIndex("idx_audit_events_scope_sequence").on(
      sql`coalesce(${table.requestId}, '__global__')`,
      table.sequence,
    ),
    index("idx_audit_events_occurred").on(table.occurredAt),
  ],
);

// 共通運営ロールは旧grantやMusic所属から自動生成しない
export const platformRoles = sqliteTable("platform_roles", {
  githubUserId: text("github_user_id").primaryKey().references(() => users.githubUserId),
  role: text("role", { enum: ["user", "assistant", "executive", "admin"] }).notNull(),
  changedBy: text("changed_by").notNull(), changedAt: text("changed_at").notNull(),
});

// 招待は数値本人IDへ固定し、受諾時にも発行者の現在権限を確認する
export const memberInvitations = sqliteTable("member_invitations", {
  id: text("id").primaryKey(), recipient: text("recipient").notNull().references(() => users.githubUserId),
  role: text("role", { enum: ["assistant", "executive"] }).notNull(),
  issuer: text("issuer").notNull().references(() => users.githubUserId),
  expiresAt: text("expires_at").notNull(), acceptedAt: text("accepted_at"),
});

// 成功・失敗・拒否の主体を追跡する追加監査記録
export const operationEvents = sqliteTable("operation_events", {
  id: text("id").primaryKey(), actor: text("actor"), action: text("action").notNull(),
  target: text("target").notNull(), result: text("result").notNull(), at: text("at").notNull(),
});

// 正常公開済みmanifestを固定した復旧操作
export const publicationRecoveries = sqliteTable("publication_recoveries", {
  requestId: text("request_id").primaryKey().references(() => deploymentRequests.requestId),
  mode: text("mode", { enum: ["rollback", "suspend", "resume"] }).notNull(),
  manifestSha256: text("manifest_sha256").notNull(),
});

// 許可名をプロフィールの自動更新から分離し、取消と再承認を世代で区別する
export const operatorAdmissions = sqliteTable("operator_admissions", {
  githubUserId: text("github_user_id").primaryKey().references(() => users.githubUserId),
  approvedLogin: text("approved_login").notNull(), version: text("version").notNull(), revokedAt: text("revoked_at"),
});

// 未ログインの本人も招待でき、古いmember_invitationsは認可に使わない
export const operatorInvitations = sqliteTable("operator_invitations", {
  id: text("id").primaryKey(), recipient: text("recipient").notNull(), login: text("login").notNull(),
  avatarUrl: text("avatar_url").notNull(), role: text("role",{enum:["assistant","executive","admin"]}).notNull(),
  issuer: text("issuer").notNull().references(() => users.githubUserId), issuerRole: text("issuer_role").notNull(),
  issuerVersion: text("issuer_version").notNull(), kind: text("kind",{enum:["invite","reapprove"]}).notNull(),
  expiresAt: text("expires_at").notNull(), acceptedAt: text("accepted_at"), acceptedToken: text("accepted_token"), revokedAt: text("revoked_at"),
}, table => [uniqueIndex("operator_invitation_pending").on(table.recipient).where(sql`${table.acceptedAt} IS NULL AND ${table.revokedAt} IS NULL`)]);


// 通知受信は本人の明示同意と在籍バージョンに結び付ける
export const ltPushPreferences = sqliteTable("lt_push_preferences", {
  userId: text("user_id").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  admissionVersion: text("admission_version").notNull(),
});

// 配信先はブラウザーごとに一意とし、鍵と配信結果を非公開で保存する
export const ltPushSubscriptions = sqliteTable("lt_push_subscriptions", {
  endpoint: text("endpoint").primaryKey(), userId: text("user_id").notNull(),
  subscription: text("subscription").notNull(), signature: text("signature").notNull().default(""),
  leaseUntil: integer("lease_until").notNull().default(0),
  lastSentAt: integer("last_sent_at"), lastError: integer("last_error"),
}, table => [index("lt_push_user").on(table.userId)]);

export const ltPushStatus = sqliteTable("lt_push_status", {
  id: integer("id").primaryKey(), checkedAt: integer("checked_at"), outcome: text("outcome").notNull(),
});
