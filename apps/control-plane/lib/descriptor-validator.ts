import {
  MAX_ARTIFACT_BYTES,
  MAX_ARTIFACT_FILES,
  type ArtifactDescriptor,
} from "./artifact-limits.ts";

export type ValidationResult =
  | { valid: true; descriptor: ArtifactDescriptor; errors: [] }
  | { valid: false; descriptor: null; errors: string[] };

export function validateDescriptorSchema(raw: unknown): ValidationResult {
  const errors: string[] = [];

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { valid: false, descriptor: null, errors: ["descriptorはJSONオブジェクトである必要があります"] };
  }

  const obj = raw as Record<string, unknown>;

  if (obj.schemaVersion !== 1) {
    errors.push("schemaVersionは 1 である必要があります");
  }

  const artifactId = typeof obj.artifactId === "string" ? obj.artifactId.trim().toLowerCase() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(artifactId)) {
    errors.push("artifactIdがUUIDv4形式ではありません");
  }

  const artifactFile = typeof obj.artifactFile === "string" ? obj.artifactFile.trim() : "";
  if (!/^[^/\\]+\.zip$/.test(artifactFile) || artifactFile.length > 180) {
    errors.push("artifactFileはスラッシュを含まない180文字以内のZIPファイル名である必要があります");
  }

  const gameId = typeof obj.gameId === "string" ? obj.gameId.trim() : "";
  if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(gameId)) {
    errors.push("gameIdは3～64文字の英小文字・数字・ハイフンで指定してください");
  }

  const version = typeof obj.version === "string" ? obj.version.trim() : "";
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version)) {
    errors.push("versionは 1.0.0 形式のセマンティックバージョンで指定してください");
  }

  if (obj.platform !== "windows") {
    errors.push("platformは windows である必要があります");
  }

  if (obj.arch !== "x86_64") {
    errors.push("archは x86_64 である必要があります");
  }

  const sizeBytes = typeof obj.sizeBytes === "number" ? obj.sizeBytes : -1;
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_ARTIFACT_BYTES) {
    errors.push("sizeBytesは1バイト以上5 GiB以下の整数である必要があります");
  }

  const fileCount = typeof obj.fileCount === "number" ? obj.fileCount : -1;
  if (!Number.isSafeInteger(fileCount) || fileCount <= 0 || fileCount > MAX_ARTIFACT_FILES) {
    errors.push("fileCountは1以上50,000以下の整数である必要があります");
  }

  const sha256 = typeof obj.sha256 === "string" ? obj.sha256.trim().toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    errors.push("sha256は64文字の16進数ハッシュである必要があります");
  }

  const createdAt = typeof obj.createdAt === "string" ? obj.createdAt.trim() : "";
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(createdAt) ||
    !Number.isFinite(Date.parse(createdAt))
  ) {
    errors.push("createdAtは有効なISO 8601日付文字列である必要があります");
  }

  if (errors.length > 0) {
    return { valid: false, descriptor: null, errors };
  }

  const descriptor: ArtifactDescriptor = {
    schemaVersion: 1,
    artifactId,
    artifactFile,
    gameId,
    version,
    platform: "windows",
    arch: "x86_64",
    sizeBytes,
    fileCount,
    sha256,
    createdAt,
  };

  return { valid: true, descriptor, errors: [] };
}
