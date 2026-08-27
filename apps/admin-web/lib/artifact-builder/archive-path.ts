import { ArtifactValidationError } from "./types.ts";

export const MAX_ARCHIVE_PATH_LENGTH = 240;

export const WINDOWS_RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

// Windows forbidden characters: < > : " | ? *
const WINDOWS_FORBIDDEN_CHARS_REGEX = /[<>:"|?*]/;

/**
 * Validates the raw string structure of a relative path.
 * Rejects leading backslash, UNC (\\...), drive-qualified (C:...), leading slash,
 * absolute paths, control characters (including NUL), Windows forbidden chars (<>:"|?*),
 * path traversal (..), empty segments, trailing spaces/periods, Windows reserved device names,
 * and paths longer than 240 characters.
 */
export function validateRawPathStructure(
  rawPath: string,
  errorPrefix: string = "安全でないパスです",
): void {
  if (typeof rawPath !== "string" || rawPath.length === 0) {
    throw new ArtifactValidationError(`${errorPrefix}: パスが空です`);
  }

  if (rawPath.length > MAX_ARCHIVE_PATH_LENGTH) {
    throw new ArtifactValidationError(`${errorPrefix} (240文字を超えています): ${rawPath}`);
  }

  // Check for control characters (0-31 and 127, including NUL \0)
  for (let i = 0; i < rawPath.length; i++) {
    const code = rawPath.charCodeAt(i);
    if (code < 32 || code === 127) {
      throw new ArtifactValidationError(`${errorPrefix} (制御文字が含まれています): ${rawPath}`);
    }
  }

  // Reject leading slash or backslash (including UNC \\... and /...)
  if (rawPath.startsWith("/") || rawPath.startsWith("\\")) {
    throw new ArtifactValidationError(
      `${errorPrefix} (先頭スラッシュ・バックスラッシュ・UNCパスは使用できません): ${rawPath}`,
    );
  }

  // Reject drive-qualified paths (e.g. C:, c:, D:)
  if (/^[a-zA-Z]:/.test(rawPath)) {
    throw new ArtifactValidationError(
      `${errorPrefix} (ドライブ絶対パスは使用できません): ${rawPath}`,
    );
  }

  // Reject trailing space or period on overall path
  if (rawPath.endsWith(" ") || rawPath.endsWith(".")) {
    throw new ArtifactValidationError(
      `${errorPrefix} (末尾が空白またはピリオドのパスは使用できません): ${rawPath}`,
    );
  }

  // Split into segments by / or \
  const parts = rawPath.split(/[/\\]/);
  for (const part of parts) {
    if (part === "" || part === ".") {
      throw new ArtifactValidationError(
        `${errorPrefix} (空または不正なパスセグメントです): ${rawPath}`,
      );
    }
    if (part === "..") {
      throw new ArtifactValidationError(
        `${errorPrefix} (ディレクトリトラバーサルは使用できません): ${rawPath}`,
      );
    }
    if (part.endsWith(" ") || part.endsWith(".")) {
      throw new ArtifactValidationError(
        `${errorPrefix} (セグメント末尾が空白またはピリオドのパスは使用できません): ${rawPath}`,
      );
    }
    if (WINDOWS_FORBIDDEN_CHARS_REGEX.test(part)) {
      throw new ArtifactValidationError(
        `${errorPrefix} (Windows禁止文字が含まれています): ${rawPath}`,
      );
    }
    const baseName = part.split(".", 1)[0].toUpperCase();
    if (WINDOWS_RESERVED_NAMES.has(baseName)) {
      throw new ArtifactValidationError(
        `${errorPrefix} (Windows予約名は使用できません): ${rawPath}`,
      );
    }
  }
}

/**
 * Validates a relative archive path inside the ZIP artifact according to desktop specification.
 * Must start with 'build/' or 'metadata/', use POSIX slashes, and pass strict Windows safety checks.
 */
export function validateArchivePath(posixPath: string): string {
  validateRawPathStructure(posixPath, "artifact内パスが不正です");

  if (posixPath.includes("\\")) {
    throw new ArtifactValidationError(
      `artifact内パスにはバックスラッシュを使用できません: ${posixPath}`,
    );
  }

  const parts = posixPath.split("/");
  if (parts[0] !== "build" && parts[0] !== "metadata") {
    throw new ArtifactValidationError(
      `artifact内パスは build/ または metadata/ で始まる必要があります: ${posixPath}`,
    );
  }

  return posixPath;
}

/**
 * Validates and normalizes a relative path from the build folder to standard posix form (e.g. "MyGame.exe", "Data/file.txt").
 * Strictly rejects leading backslashes, UNC, drive paths, absolute paths, trailing spaces/dots, control chars, and traversal.
 */
export function normalizeBuildRelativePath(rawPath: string): string {
  validateRawPathStructure(rawPath, "ビルド内相対パスが不正です");
  return rawPath.replace(/\\/g, "/");
}
