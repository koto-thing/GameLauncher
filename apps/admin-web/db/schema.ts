import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

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
