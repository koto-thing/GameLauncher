import { env } from "cloudflare:workers";
import { AwsClient } from "aws4fetch";
import { ensureSchema, getD1 } from "@/db/initialize";
import type { SessionUser } from "@/lib/auth";
import {
  auditRecord,
  requireRequester,
} from "@/lib/control-plane";
import {
  MAX_ARTIFACT_BYTES,
  MAX_ARTIFACT_FILES,
  INTAKE_PART_SIZE,
  PRESIGNED_URL_SECONDS,
  type ArtifactDescriptor,
} from "@/lib/artifact-limits";

export {
  INTAKE_PART_SIZE,
  PRESIGNED_URL_SECONDS,
  type ArtifactDescriptor,
};

const UPLOAD_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

type IntakeEnv = {
  INTAKE?: R2Bucket;
  INTAKE_R2_ACCOUNT_ID?: string;
  INTAKE_R2_BUCKET?: string;
  INTAKE_R2_ACCESS_KEY_ID?: string;
  INTAKE_R2_SECRET_ACCESS_KEY?: string;
};

type Row = Record<string, unknown>;

function runtimeEnv(): IntakeEnv {
  return env as unknown as IntakeEnv;
}

function bucket(): R2Bucket {
  const value = runtimeEnv().INTAKE;
  if (!value) throw new Error("intake R2 binding is unavailable");
  return value;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function number(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

function validateDescriptor(input: ArtifactDescriptor): ArtifactDescriptor {
  if (input.schemaVersion !== 1) throw new Error("descriptor schemaVersionが不正です");
  const artifactId = text(input.artifactId).trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(artifactId)) {
    throw new Error("artifact IDが不正です");
  }
  if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(input.gameId)) {
    throw new Error("ゲームIDが不正です");
  }
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(input.version)) {
    throw new Error("バージョンが不正です");
  }
  if (input.platform !== "windows" || input.arch !== "x86_64") {
    throw new Error("artifact対象環境が不正です");
  }
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > MAX_ARTIFACT_BYTES) {
    throw new Error("artifact容量は1 byte以上5 GiB以下です");
  }
  if (!Number.isSafeInteger(input.fileCount) || input.fileCount <= 0 || input.fileCount > MAX_ARTIFACT_FILES) {
    throw new Error("ファイル数は1～50,000です");
  }
  const sha256 = text(input.sha256).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("SHA-256が不正です");
  if (!/^[^/\\]+\.zip$/.test(input.artifactFile) || input.artifactFile.length > 180) {
    throw new Error("artifactファイル名が不正です");
  }
  const createdAt = text(input.createdAt).trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(createdAt) ||
      !Number.isFinite(Date.parse(createdAt))) {
    throw new Error("descriptor作成日時が不正です");
  }
  return { ...input, artifactId, sha256 };
}

async function uploadRow(artifactId: string, actor: SessionUser): Promise<Row> {
  const row = await getD1().prepare(`SELECT * FROM intake_uploads
    WHERE artifact_id = ? AND requester_github_user_id = ?`)
    .bind(artifactId, actor.githubUserId).first<Row>();
  if (!row) throw new Error("intake uploadが見つかりません");
  return row;
}

function uploadSummary(row: Row, uploadedParts: number[]) {
  return {
    artifactId: text(row.artifact_id),
    partSize: number(row.part_size),
    partCount: number(row.part_count),
    state: text(row.state),
    expiresAt: text(row.expires_at),
    uploadedParts,
  };
}

async function partNumbers(artifactId: string): Promise<number[]> {
  const result = await getD1().prepare(`SELECT part_number FROM intake_upload_parts
    WHERE artifact_id = ? ORDER BY part_number`).bind(artifactId).all<{ part_number: number }>();
  return result.results.map((row) => row.part_number);
}

export async function createOrResumeUpload(actor: SessionUser, descriptorInput: ArtifactDescriptor) {
  await ensureSchema();
  await requireRequester(actor);
  const descriptor = validateDescriptor(descriptorInput);
  const db = getD1();
  const existingArtifact = await db.prepare("SELECT 1 AS found FROM artifacts WHERE artifact_id = ?")
    .bind(descriptor.artifactId).first<{ found: number }>();
  if (existingArtifact) throw new Error("このartifactはすでにseal済みです");
  const existing = await db.prepare("SELECT * FROM intake_uploads WHERE artifact_id = ?")
    .bind(descriptor.artifactId).first<Row>();
  if (existing) {
    if (text(existing.requester_github_user_id) !== actor.githubUserId) {
      throw new Error("このartifact IDは別の申請者が使用しています");
    }
    if (text(existing.claimed_sha256) !== descriptor.sha256 ||
        number(existing.size_bytes) !== descriptor.sizeBytes ||
        number(existing.file_count) !== descriptor.fileCount ||
        text(existing.game_id) !== descriptor.gameId ||
        text(existing.version) !== descriptor.version) {
      throw new Error("再開するartifactのdescriptorが初回登録時と一致しません");
    }
    if (text(existing.state) !== "uploading") throw new Error("このuploadは再開できません");
    return uploadSummary(existing, await partNumbers(descriptor.artifactId));
  }

  const key = `artifacts/${descriptor.artifactId}.zip`;
  const multipart = await bucket().createMultipartUpload(key, {
    httpMetadata: { contentType: "application/zip" },
    customMetadata: { artifactId: descriptor.artifactId, claimedSha256: descriptor.sha256 },
  });
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + UPLOAD_LIFETIME_MS).toISOString();
  const partCount = Math.ceil(descriptor.sizeBytes / INTAKE_PART_SIZE);
  try {
    const audit = await auditRecord(null, "artifact_upload_started", actor, {
      artifactId: descriptor.artifactId,
      sizeBytes: descriptor.sizeBytes,
      fileCount: descriptor.fileCount,
      sha256: descriptor.sha256,
      partCount,
    });
    await db.batch([
      db.prepare(`INSERT INTO intake_uploads
        (artifact_id, intake_object_key, multipart_upload_id, requester_github_user_id,
         size_bytes, file_count, claimed_sha256, game_id, version, part_size, part_count,
         state, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?)`)
        .bind(
          descriptor.artifactId, key, multipart.uploadId, actor.githubUserId,
          descriptor.sizeBytes, descriptor.fileCount, descriptor.sha256,
          descriptor.gameId, descriptor.version, INTAKE_PART_SIZE, partCount,
          createdAt, expiresAt,
        ),
      audit,
    ]);
  } catch (error) {
    await multipart.abort();
    throw error;
  }
  return {
    artifactId: descriptor.artifactId,
    partSize: INTAKE_PART_SIZE,
    partCount,
    state: "uploading",
    expiresAt,
    uploadedParts: [],
  };
}

function s3Config(): { accountId: string; bucketName: string; client: AwsClient } | null {
  const current = runtimeEnv();
  if (!current.INTAKE_R2_ACCOUNT_ID || !current.INTAKE_R2_BUCKET ||
      !current.INTAKE_R2_ACCESS_KEY_ID || !current.INTAKE_R2_SECRET_ACCESS_KEY) return null;
  return {
    accountId: current.INTAKE_R2_ACCOUNT_ID,
    bucketName: current.INTAKE_R2_BUCKET,
    client: new AwsClient({
      service: "s3",
      region: "auto",
      accessKeyId: current.INTAKE_R2_ACCESS_KEY_ID,
      secretAccessKey: current.INTAKE_R2_SECRET_ACCESS_KEY,
    }),
  };
}

export async function issuePartUrls(
  request: Request,
  actor: SessionUser,
  artifactId: string,
  requestedParts: number[],
) {
  await ensureSchema();
  const row = await uploadRow(artifactId, actor);
  if (text(row.state) !== "uploading") throw new Error("upload中のartifactではありません");
  if (Date.parse(text(row.expires_at)) <= Date.now()) throw new Error("intake uploadの期限が切れています");
  const count = number(row.part_count);
  const uniqueParts = [...new Set(requestedParts)];
  if (uniqueParts.length < 1 || uniqueParts.length > 4 ||
      uniqueParts.some((part) => !Number.isSafeInteger(part) || part < 1 || part > count)) {
    throw new Error("一度に発行できるpart URLは1～4件です");
  }
  const config = s3Config();
  if (!config) {
    const origin = new URL(request.url).origin;
    return {
      transport: "worker-proxy" as const,
      expiresIn: PRESIGNED_URL_SECONDS,
      parts: uniqueParts.map((partNumber) => ({
        partNumber,
        url: `${origin}/api/intake/uploads/${encodeURIComponent(artifactId)}/parts/${partNumber}`,
      })),
    };
  }
  const key = text(row.intake_object_key).split("/").map(encodeURIComponent).join("/");
  const uploadId = encodeURIComponent(text(row.multipart_upload_id));
  const parts = await Promise.all(uniqueParts.map(async (partNumber) => {
    const url = `https://${config.accountId}.r2.cloudflarestorage.com/` +
      `${encodeURIComponent(config.bucketName)}/${key}?partNumber=${partNumber}` +
      `&uploadId=${uploadId}&X-Amz-Expires=${PRESIGNED_URL_SECONDS}`;
    const signed = await config.client.sign(new Request(url, { method: "PUT" }), {
      aws: { signQuery: true },
    });
    return { partNumber, url: signed.url };
  }));
  return { transport: "direct-r2" as const, expiresIn: PRESIGNED_URL_SECONDS, parts };
}

export async function uploadLocalPart(
  actor: SessionUser,
  artifactId: string,
  partNumber: number,
  body: ReadableStream | null,
  contentLength?: number | null,
) {
  await ensureSchema();
  const row = await uploadRow(artifactId, actor);
  if (text(row.state) !== "uploading" || !body) throw new Error("upload中のartifactではありません");
  const expected = expectedPartSize(row, partNumber);
  if (contentLength !== null && contentLength !== undefined && !Number.isNaN(contentLength)) {
    if (contentLength !== expected) throw new Error("part容量が期待値と一致しません");
  }
  const multipart = bucket().resumeMultipartUpload(
    text(row.intake_object_key), text(row.multipart_upload_id),
  );
  const uploaded = await multipart.uploadPart(partNumber, body);
  await recordPart(actor, artifactId, partNumber, uploaded.etag, expected);
  return uploaded;
}

function expectedPartSize(row: Row, partNumber: number): number {
  const count = number(row.part_count);
  if (!Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > count) {
    throw new Error("part番号が不正です");
  }
  const size = number(row.size_bytes);
  const partSize = number(row.part_size);
  return partNumber === count ? size - partSize * (count - 1) : partSize;
}

export async function recordPart(
  actor: SessionUser,
  artifactId: string,
  partNumber: number,
  etagInput: string,
  sizeBytes: number,
) {
  await ensureSchema();
  const row = await uploadRow(artifactId, actor);
  if (text(row.state) !== "uploading") throw new Error("upload中のartifactではありません");
  if (sizeBytes !== expectedPartSize(row, partNumber)) throw new Error("part容量が期待値と一致しません");
  const etag = etagInput.trim().replace(/^"(.*)"$/, "$1");
  if (!etag || etag.length > 1024 || /[\r\n]/.test(etag)) throw new Error("ETagが不正です");
  await getD1().prepare(`INSERT INTO intake_upload_parts
    (artifact_id, part_number, etag, size_bytes, recorded_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(artifact_id, part_number) DO UPDATE SET
      etag = excluded.etag, size_bytes = excluded.size_bytes, recorded_at = excluded.recorded_at`)
    .bind(artifactId, partNumber, etag, sizeBytes, new Date().toISOString()).run();
}

export async function sealUpload(actor: SessionUser, artifactId: string) {
  await ensureSchema();
  const row = await uploadRow(artifactId, actor);
  if (text(row.state) !== "uploading") throw new Error("upload中のartifactではありません");
  const partsResult = await getD1().prepare(`SELECT part_number, etag, size_bytes
    FROM intake_upload_parts WHERE artifact_id = ? ORDER BY part_number`)
    .bind(artifactId).all<{ part_number: number; etag: string; size_bytes: number }>();
  const count = number(row.part_count);
  if (partsResult.results.length !== count ||
      partsResult.results.some((part, index) => part.part_number !== index + 1 ||
        part.size_bytes !== expectedPartSize(row, part.part_number))) {
    throw new Error("すべてのpart uploadが完了していません");
  }
  const db = getD1();
  const transition = await db.prepare(`UPDATE intake_uploads SET state = 'sealing'
    WHERE artifact_id = ? AND requester_github_user_id = ? AND state = 'uploading'`)
    .bind(artifactId, actor.githubUserId).run();
  if (number(transition.meta.changes) !== 1) throw new Error("別のseal処理が進行中です");
  try {
    const objectKey = text(row.intake_object_key);
    let object = await bucket().head(objectKey);
    if (!object) {
      const multipart = bucket().resumeMultipartUpload(
        objectKey, text(row.multipart_upload_id),
      );
      await multipart.complete(partsResult.results.map((part) => ({
        partNumber: part.part_number,
        etag: part.etag,
      })));
      object = await bucket().head(objectKey);
    }
    if (!object || object.size !== number(row.size_bytes)) {
      throw new Error("sealed objectの容量を検証できませんでした");
    }
    const timestamp = new Date().toISOString();
    const audit = await auditRecord(null, "artifact_sealed", actor, {
      artifactId,
      sizeBytes: number(row.size_bytes),
      fileCount: number(row.file_count),
      sha256: text(row.claimed_sha256),
      partCount: count,
    });
    await db.batch([
      db.prepare(`INSERT INTO artifacts
        (artifact_id, intake_object_key, size_bytes, file_count, claimed_sha256, status, sealed_at)
        VALUES (?, ?, ?, ?, ?, 'sealed', ?)`)
        .bind(
          artifactId, text(row.intake_object_key), number(row.size_bytes),
          number(row.file_count), text(row.claimed_sha256), timestamp,
        ),
      db.prepare("UPDATE intake_uploads SET state = 'sealed' WHERE artifact_id = ?")
        .bind(artifactId),
      audit,
    ]);
    return { artifactId, state: "sealed" };
  } catch (error) {
    await db.prepare("UPDATE intake_uploads SET state = 'uploading' WHERE artifact_id = ? AND state = 'sealing'")
      .bind(artifactId).run();
    throw error;
  }
}

export async function cancelUpload(actor: SessionUser, artifactId: string) {
  await ensureSchema();
  const row = await uploadRow(artifactId, actor);
  if (text(row.state) !== "uploading") throw new Error("upload中のartifactだけをキャンセルできます");
  await bucket().resumeMultipartUpload(
    text(row.intake_object_key), text(row.multipart_upload_id),
  ).abort();
  const audit = await auditRecord(null, "artifact_upload_cancelled", actor, { artifactId });
  await getD1().batch([
    getD1().prepare("UPDATE intake_uploads SET state = 'cancelled' WHERE artifact_id = ?")
      .bind(artifactId),
    audit,
  ]);
}

export async function issueArtifactDownloadUrl(artifactId: string): Promise<string> {
  await ensureSchema();
  const artifact = await getD1().prepare(`SELECT intake_object_key, status FROM artifacts
    WHERE artifact_id = ?`).bind(artifactId).first<Row>();
  if (!artifact || text(artifact.status) !== "sealed") throw new Error("sealed artifactが見つかりません");
  const config = s3Config();
  if (!config) throw new Error("intake R2 download設定が不足しています");
  const key = text(artifact.intake_object_key).split("/").map(encodeURIComponent).join("/");
  const url = `https://${config.accountId}.r2.cloudflarestorage.com/` +
    `${encodeURIComponent(config.bucketName)}/${key}?X-Amz-Expires=${PRESIGNED_URL_SECONDS}`;
  const signed = await config.client.sign(new Request(url), { aws: { signQuery: true } });
  return signed.url;
}
