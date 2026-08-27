import {
  MAX_ARTIFACT_BYTES,
  MAX_ARTIFACT_FILES,
} from "../artifact-limits.ts";
import {
  validateArchivePath,
  normalizeBuildRelativePath,
} from "./archive-path.ts";
import {
  ArtifactValidationError,
  type BuildInputFile,
  type ReleaseDraft,
  type ReleasePreview,
} from "./types.ts";

export const VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
export const GAME_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
export const SAVE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/;
export const LOCALE_TAG_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
export const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
export const SUPPORTED_ENGINES = new Set(["unity", "godot", "siv3d"]);

export function getFileExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx >= 0 ? filename.slice(idx).toLowerCase() : "";
}

export function validateLocaleTag(locale: string): string {
  if (!LOCALE_TAG_PATTERN.test(locale)) {
    throw new ArtifactValidationError(`言語タグが不正です: ${locale}`);
  }
  return locale;
}

export function computeLaunchPaths(entrypointRelativePath: string): {
  entrypoint: string;
  workingDirectory: string;
} {
  const normalized = normalizeBuildRelativePath(entrypointRelativePath);
  if (!normalized) {
    throw new ArtifactValidationError("起動exeを選択してください");
  }
  if (!normalized.toLowerCase().endsWith(".exe")) {
    throw new ArtifactValidationError("Windowsの起動exeを選択してください");
  }

  const parts = normalized.split("/");
  const parent = parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
  return {
    entrypoint: normalized,
    workingDirectory: parent,
  };
}

export type ValidatedBuildFiles = {
  files: { file: BuildInputFile; archivePath: string }[];
  totalBytes: number;
};

/**
 * Validates build files, checks for path safety, case-insensitive collision,
 * empty files, file count and total size limits.
 */
export function validateAndCollectBuildFiles(
  buildFiles: BuildInputFile[],
): ValidatedBuildFiles {
  if (!buildFiles || buildFiles.length === 0) {
    throw new ArtifactValidationError("ビルドフォルダにファイルがありません");
  }

  if (buildFiles.length > MAX_ARTIFACT_FILES) {
    throw new ArtifactValidationError("ビルドに含められるファイル数は50,000件までです");
  }

  // Validate each file path first
  const validatedItems = buildFiles.map((file) => {
    const rawRel = file.relativePath || file.name;
    const rel = normalizeBuildRelativePath(rawRel);
    return { file, rel };
  });

  // Sort by posix path casefold order for deterministic output
  const sorted = validatedItems.sort((a, b) => {
    return a.rel.toLowerCase().localeCompare(b.rel.toLowerCase());
  });

  const files: { file: BuildInputFile; archivePath: string }[] = [];
  const casefoldedMap = new Map<string, string>();
  let totalBytes = 0;

  for (const { file, rel } of sorted) {
    const archivePath = validateArchivePath(`build/${rel}`);
    const collisionKey = archivePath.toLowerCase();

    const previous = casefoldedMap.get(collisionKey);
    if (previous !== undefined) {
      throw new ArtifactValidationError(
        `大文字小文字だけが異なるパスは同時に使用できません: ${previous}, ${archivePath}`,
      );
    }
    casefoldedMap.set(collisionKey, archivePath);

    if (file.size === 0) {
      throw new ArtifactValidationError(`空ファイルはartifactに含められません: ${archivePath}`);
    }

    totalBytes += file.size;
    if (totalBytes > MAX_ARTIFACT_BYTES) {
      throw new ArtifactValidationError("ビルドの合計容量は5 GiB以下にしてください");
    }

    files.push({ file, archivePath });
  }

  return { files, totalBytes };
}

/**
 * Validates a complete ReleaseDraft according to desktop specification.
 * Returns ReleasePreview summary on success or throws ArtifactValidationError with all collected errors.
 */
export function validateDraft(draft: ReleaseDraft): ReleasePreview {
  const errors: string[] = [];

  if (!draft.gameId || !GAME_ID_PATTERN.test(draft.gameId.trim())) {
    errors.push("ゲームIDは3～64文字の英小文字・数字・ハイフンで入力してください");
  }

  if (!draft.version || !VERSION_PATTERN.test(draft.version.trim())) {
    errors.push("バージョンは1.2.3形式で入力してください");
  }

  if (
    !draft.minimumLauncherVersion ||
    !VERSION_PATTERN.test(draft.minimumLauncherVersion.trim())
  ) {
    errors.push("最小ランチャーバージョンは1.2.3形式で入力してください");
  }

  if (!SUPPORTED_ENGINES.has(draft.engine)) {
    errors.push("対応するゲームエンジンを選択してください");
  }

  if (
    !draft.saveDirectoryName ||
    !SAVE_NAME_PATTERN.test(draft.saveDirectoryName.trim())
  ) {
    errors.push("セーブディレクトリ名は2～64文字の英数字・_・-で入力してください");
  }

  if (!draft.translations || !("ja-JP" in draft.translations)) {
    errors.push("日本語のゲーム名と説明は必須です");
  }

  if (draft.translations) {
    for (const [locale, translation] of Object.entries(draft.translations)) {
      if (!LOCALE_TAG_PATTERN.test(locale)) {
        errors.push(`言語タグが不正です: ${locale}`);
      }
      const name = (translation.name || "").trim();
      const summary = (translation.summary || "").trim();
      if (name.length < 1 || name.length > 100 || summary.length < 1 || summary.length > 500) {
        errors.push(`${locale}の名前または説明の文字数が範囲外です`);
      }
    }
  }

  for (const [label, image] of [
    ["hero", draft.hero],
    ["thumbnail", draft.thumbnail],
  ] as const) {
    if (!image) {
      errors.push(`${label}画像を選択してください`);
    } else {
      const ext = getFileExtension(image.name);
      if (!IMAGE_EXTENSIONS.has(ext)) {
        errors.push(`${label}画像にはPNG、JPEG、WebPを指定してください`);
      }
    }
  }

  const focalX = draft.focalPoint?.x ?? 0.5;
  const focalY = draft.focalPoint?.y ?? 0.5;
  if (
    typeof focalX !== "number" ||
    typeof focalY !== "number" ||
    !Number.isFinite(focalX) ||
    !Number.isFinite(focalY) ||
    focalX < 0 ||
    focalX > 1 ||
    focalY < 0 ||
    focalY > 1
  ) {
    errors.push("hero焦点位置は0から1の範囲で指定してください");
  }

  let entrypoint = "";
  let workingDirectory = "";
  try {
    const launch = computeLaunchPaths(draft.entrypointRelativePath);
    entrypoint = launch.entrypoint;
    workingDirectory = launch.workingDirectory;

    // Verify entrypoint exists in buildFiles
    const normEntry = normalizeBuildRelativePath(draft.entrypointRelativePath);
    const entryFileExists = (draft.buildFiles || []).some((f) => {
      try {
        return normalizeBuildRelativePath(f.relativePath || f.name) === normEntry;
      } catch {
        return false;
      }
    });
    if (!entryFileExists) {
      errors.push("起動exeはビルドフォルダ内から選択してください");
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  let totalBytes = 0;
  let fileCount = 0;
  try {
    const validated = validateAndCollectBuildFiles(draft.buildFiles);
    totalBytes = validated.totalBytes;
    fileCount = validated.files.length;
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  if (errors.length > 0) {
    throw new ArtifactValidationError(errors.join("\n"), errors);
  }

  const locales = Object.keys(draft.translations).sort();

  return {
    files: fileCount,
    totalBytes,
    entrypoint,
    workingDirectory,
    locales,
  };
}
