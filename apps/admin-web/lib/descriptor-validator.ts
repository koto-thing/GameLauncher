import {
  type ArtifactDescriptor,
} from "./artifact-limits.ts";
import {
  validateDescriptorAjv,
  type ErrorObject,
} from "./schema-validator.ts";

export type ValidationResult =
  | { valid: true; descriptor: ArtifactDescriptor; errors: [] }
  | { valid: false; descriptor: null; errors: string[] };

function formatDescriptorError(err: ErrorObject): string {
  if (err.keyword === "additionalProperties") {
    const prop = (err.params as { additionalProperty?: string }).additionalProperty;
    return `未知のプロパティが含まれています: ${prop}`;
  }
  if (err.keyword === "required") {
    const missing = (err.params as { missingProperty?: string }).missingProperty;
    return `${missing}は必須です`;
  }

  const path = err.instancePath;
  if (path === "/schemaVersion") {
    return "schemaVersionは 1 である必要があります";
  }
  if (path === "/artifactId") {
    return "artifactIdがUUIDv4形式ではありません";
  }
  if (path === "/artifactFile") {
    return "artifactFileはスラッシュを含まない180文字以内のZIPファイル名である必要があります";
  }
  if (path === "/gameId") {
    return "gameIdは3～64文字の英小文字・数字・ハイフンで指定してください";
  }
  if (path === "/version") {
    return "versionは 1.0.0 形式のセマンティックバージョンで指定してください";
  }
  if (path === "/platform") {
    return "platformは windows である必要があります";
  }
  if (path === "/arch") {
    return "archは x86_64 である必要があります";
  }
  if (path === "/sizeBytes") {
    return "sizeBytesは1バイト以上5 GiB以下の整数である必要があります";
  }
  if (path === "/fileCount") {
    return "fileCountは1以上50,000以下の整数である必要があります";
  }
  if (path === "/sha256") {
    return "sha256は64文字の16進数ハッシュである必要があります";
  }
  if (path === "/createdAt") {
    return "createdAtは有効なISO 8601日付文字列である必要があります";
  }

  return `${path ? path.slice(1) + ": " : ""}${err.message ?? "値が不正です"}`;
}

export function validateDescriptorSchema(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { valid: false, descriptor: null, errors: ["descriptorはJSONオブジェクトである必要があります"] };
  }

  const valid = validateDescriptorAjv(raw);
  if (!valid) {
    const errors: string[] = (validateDescriptorAjv.errors || []).map(formatDescriptorError);
    return { valid: false, descriptor: null, errors };
  }

  const obj = raw as Record<string, unknown>;
  const descriptor: ArtifactDescriptor = {
    schemaVersion: 1,
    artifactId: String(obj.artifactId),
    artifactFile: String(obj.artifactFile),
    gameId: String(obj.gameId),
    version: String(obj.version),
    platform: "windows",
    arch: "x86_64",
    sizeBytes: obj.sizeBytes as number,
    fileCount: obj.fileCount as number,
    sha256: String(obj.sha256),
    createdAt: String(obj.createdAt),
  };

  return { valid: true, descriptor, errors: [] };
}
