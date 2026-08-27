import {
  MAX_ARTIFACT_BYTES,
  MAX_ARTIFACT_FILES,
  type ArtifactDescriptor,
} from "../artifact-limits.ts";
import { validateDescriptorSchema } from "../descriptor-validator.ts";
import { hashFileInChunks } from "../sha256-stream.ts";
import { validateArchivePath } from "./archive-path.ts";
import { createMetadata } from "./metadata.ts";
import {
  ArtifactBuildCancelledError,
  ArtifactValidationError,
  type ArtifactBuildProgress,
  type ArtifactBuildResult,
  type ReleaseDraft,
} from "./types.ts";
import {
  validateAndCollectBuildFiles,
  validateDraft,
} from "./validate-release.ts";
import {
  createDeterministicZip,
  type ZipEntrySource,
} from "./zip-builder.ts";

export type BuildArtifactOptions = {
  onProgress?: (progress: ArtifactBuildProgress) => void;
  signal?: AbortSignal;
  artifactIdOverride?: string;
  createdAtOverride?: string;
  publishedAtOverride?: string;
};

/**
 * Builds the complete game release artifact in the browser or server environment.
 * Matches desktop ArtifactService.create() specification:
 * 1. Validates draft input, paths, boundaries, and schemas
 * 2. Generates release.json and metadata directory
 * 3. Assembles deterministic ZIP64 archive with fixed timestamps
 * 4. Incrementally computes SHA-256
 * 5. Constructs and validates ArtifactDescriptor
 */
export async function buildArtifact(
  draft: ReleaseDraft,
  options: BuildArtifactOptions = {},
): Promise<ArtifactBuildResult> {
  const {
    onProgress,
    signal,
    artifactIdOverride,
    createdAtOverride,
    publishedAtOverride,
  } = options;

  const checkCancel = () => {
    if (signal?.aborted) {
      throw new ArtifactBuildCancelledError();
    }
  };

  checkCancel();

  // Stage 1: Validate draft and collect build files
  onProgress?.({
    stage: "validating",
    stageText: "Buildフォルダを検証しています",
    detailText: "ファイルパス、容量、ファイル数を確認しています…",
    percent: 2,
  });

  const preview = validateDraft(draft);
  const validatedBuild = validateAndCollectBuildFiles(draft.buildFiles);

  // Stage 2: Create metadata files
  onProgress?.({
    stage: "metadata",
    stageText: "release.jsonを生成しています",
    detailText: "多言語表示情報とスキーマ整合性を確認しています…",
    percent: 5,
  });

  const metaResult = createMetadata(draft, preview, publishedAtOverride);

  // Combine build entries and metadata entries
  // Metadata entries order: release.json first, then other metadata files sorted
  const metadataEntries: { archivePath: string; size: number; getData: () => Promise<Uint8Array | Blob> }[] = [
    {
      archivePath: validateArchivePath("metadata/release.json"),
      size: metaResult.releaseJsonBytes.length,
      getData: async () => metaResult.releaseJsonBytes,
    },
    {
      archivePath: validateArchivePath(metaResult.heroFile.archivePath),
      size: metaResult.heroFile.file.size,
      getData: async () => metaResult.heroFile.file.slice(),
    },
    {
      archivePath: validateArchivePath(metaResult.thumbnailFile.archivePath),
      size: metaResult.thumbnailFile.file.size,
      getData: async () => metaResult.thumbnailFile.file.slice(),
    },
  ];

  // Sort non-release.json metadata files by archivePath
  const nonReleaseMeta = metadataEntries.slice(1).sort((a, b) =>
    a.archivePath.localeCompare(b.archivePath),
  );

  const allEntries: ZipEntrySource[] = [
    ...validatedBuild.files.map(({ file, archivePath }) => ({
      archivePath,
      size: file.size,
      getData: async () => file.slice(),
    })),
    metadataEntries[0],
    ...nonReleaseMeta,
  ];

  if (allEntries.length > MAX_ARTIFACT_FILES) {
    throw new ArtifactValidationError(
      `metadataを含むartifactのファイル数は50,000件までです (現在: ${allEntries.length} 件)`,
    );
  }

  const totalUncompressedBytes = allEntries.reduce((acc, e) => acc + e.size, 0);
  if (totalUncompressedBytes > MAX_ARTIFACT_BYTES) {
    throw new ArtifactValidationError(
      "metadataを含むartifactの合計容量は5 GiB以下にしてください",
    );
  }

  const artifactId =
    artifactIdOverride ||
    (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : "00000000-0000-4000-8000-000000000000");

  const artifactStem = `${draft.gameId}-${draft.version}-${artifactId}`;
  const artifactFileName = `${artifactStem}.zip`;

  // Stage 3: Create deterministic ZIP
  checkCancel();

  const zipBlob = await createDeterministicZip(allEntries, {
    signal,
    onProgress: (completed, total, currentFile) => {
      const ratio = total > 0 ? completed / total : 1;
      const pct = 5 + Math.round(ratio * 75); // 5% -> 80%
      const compMiB = (completed / (1024 * 1024)).toFixed(1);
      const totMiB = (total / (1024 * 1024)).toFixed(1);
      onProgress?.({
        stage: "zipping",
        stageText: "Artifact ZIPを作成しています",
        detailText: `${compMiB} / ${totMiB} MiB  ${currentFile}`,
        percent: pct,
        completedBytes: completed,
        totalBytes: total,
        currentFile,
      });
    },
  });

  const zipSize = zipBlob.size;
  if (zipSize > MAX_ARTIFACT_BYTES) {
    throw new ArtifactValidationError("生成したartifactは5 GiB以下にしてください");
  }

  // Stage 4: Compute SHA-256
  checkCancel();
  onProgress?.({
    stage: "hashing",
    stageText: "SHA-256を計算しています",
    detailText: "artifact全体を検証中…",
    percent: 80,
  });

  const sha256 = await hashFileInChunks(
    zipBlob,
    (processed, total) => {
      const ratio = total > 0 ? processed / total : 1;
      const pct = 80 + Math.round(ratio * 7); // 80% -> 87%
      const compMiB = (processed / (1024 * 1024)).toFixed(1);
      const totMiB = (total / (1024 * 1024)).toFixed(1);
      onProgress?.({
        stage: "hashing",
        stageText: "SHA-256を計算しています",
        detailText: `${compMiB} / ${totMiB} MiB (${Math.round(ratio * 100)}%)`,
        percent: pct,
        completedBytes: processed,
        totalBytes: total,
      });
    },
    signal,
  );

  const createdAt =
    createdAtOverride ||
    new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const descriptorRaw: ArtifactDescriptor = {
    schemaVersion: 1,
    artifactId,
    artifactFile: artifactFileName,
    gameId: draft.gameId.trim(),
    version: draft.version.trim(),
    platform: "windows",
    arch: "x86_64",
    sizeBytes: zipSize,
    fileCount: allEntries.length,
    sha256,
    createdAt,
  };

  const validation = validateDescriptorSchema(descriptorRaw);
  if (!validation.valid) {
    throw new ArtifactValidationError(
      `生成されたdescriptorがスキーマを満たしていません:\n・${validation.errors.join("\n・")}`,
      validation.errors,
    );
  }

  onProgress?.({
    stage: "completed",
    stageText: "artifactの準備が完了しました",
    detailText: artifactFileName,
    percent: 88,
  });

  return {
    artifactId,
    artifactFile: artifactFileName,
    descriptor: validation.descriptor,
    zipBlob,
    sha256,
    sizeBytes: zipSize,
    fileCount: allEntries.length,
  };
}
