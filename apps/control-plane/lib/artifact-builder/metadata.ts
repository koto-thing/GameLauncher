import {
  getFileExtension,
  validateDraft,
} from "./validate-release.ts";
import {
  ArtifactValidationError,
  type ImageInputFile,
  type ReleaseDraft,
  type ReleasePreview,
} from "./types.ts";
import {
  validateGameReleaseSourceAjv,
  type ErrorObject,
} from "../schema-validator.ts";

export type GameReleaseSourceDocument = {
  gameId: string;
  version: string;
  minimumLauncherVersion: string;
  publishedAt: string;
  engine: string;
  entrypoint: string;
  workingDirectory: string;
  saveDirectoryName: string;
  display: Record<string, { name: string; summary: string }>;
  hero: string;
  heroFocalPoint: { x: number; y: number };
  thumbnail: string;
};

function formatGameReleaseSourceError(err: ErrorObject): string {
  if (err.keyword === "additionalProperties") {
    const prop = (err.params as { additionalProperty?: string }).additionalProperty;
    return `未知のプロパティが含まれています: ${prop}`;
  }
  if (err.keyword === "required") {
    const missing = (err.params as { missingProperty?: string }).missingProperty;
    if (err.instancePath === "/display" && missing === "ja-JP") {
      return "displayにja-JPが必須です";
    }
    if (missing === "heroFocalPoint") {
      return "heroFocalPointが必要です";
    }
    if (missing === "display") {
      return "displayオブジェクトが必要です";
    }
    return `${missing}が必要です`;
  }

  const path = err.instancePath;
  if (path === "/gameId") {
    return "gameIdが不正です";
  }
  if (path === "/version") {
    return "versionが不正です";
  }
  if (path === "/minimumLauncherVersion") {
    return "minimumLauncherVersionが不正です";
  }
  if (path === "/publishedAt") {
    return "publishedAtは有効なISO 8601日時である必要があります";
  }
  if (path === "/engine") {
    return "engineが対応していません";
  }
  if (path === "/entrypoint") {
    return "entrypoint相対パスが不正です";
  }
  if (path === "/workingDirectory") {
    return "workingDirectory相対パスが不正です";
  }
  if (path === "/saveDirectoryName") {
    return "saveDirectoryNameが不正です";
  }
  if (path === "/hero") {
    return "hero相対パスが不正です";
  }
  if (path === "/thumbnail") {
    return "thumbnail相対パスが不正です";
  }
  if (path === "/heroFocalPoint" || path.startsWith("/heroFocalPoint/")) {
    return "heroFocalPointのx, yは0〜1の数値である必要があります";
  }
  if (path === "/display") {
    if (err.keyword === "propertyNames") {
      const propName = (err.params as { propertyName?: string }).propertyName;
      return `不正なlocaleタグです: ${propName}`;
    }
    if (err.keyword === "minProperties") {
      return "displayオブジェクトが必要です";
    }
    return "displayオブジェクトが必要です";
  }
  if (path.startsWith("/display/")) {
    const segs = path.split("/");
    const locale = segs[2];
    const field = segs[3];
    if (field === "name") {
      return `${locale}の名前は1〜100文字である必要があります`;
    }
    if (field === "summary") {
      return `${locale}の説明は1〜500文字である必要があります`;
    }
    return `${locale}のdisplay値が不正です`;
  }

  return `${path ? path.slice(1) + ": " : ""}${err.message ?? "値が不正です"}`;
}

/**
 * Validates a GameReleaseSourceDocument directly against contracts/schemas/game-release-source.schema.json via Ajv 2020.
 */
export function validateGameReleaseSourceSchema(doc: unknown): {
  valid: boolean;
  errors: string[];
  document?: GameReleaseSourceDocument;
} {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return { valid: false, errors: ["release.jsonはJSONオブジェクトである必要があります"] };
  }

  const valid = validateGameReleaseSourceAjv(doc);
  if (!valid) {
    const errors: string[] = (validateGameReleaseSourceAjv.errors || []).map(formatGameReleaseSourceError);
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    document: doc as GameReleaseSourceDocument,
  };
}

export type CreatedMetadataResult = {
  document: GameReleaseSourceDocument;
  releaseJsonBytes: Uint8Array;
  heroFile: { name: string; archivePath: string; file: ImageInputFile };
  thumbnailFile: { name: string; archivePath: string; file: ImageInputFile };
  preview: ReleasePreview;
};

/**
 * Creates release.json and metadata file entries matching desktop create_metadata().
 * Strictly validates against game-release-source.schema.json.
 */
export function createMetadata(
  draft: ReleaseDraft,
  previewOverride?: ReleasePreview,
  publishedAtOverride?: string,
): CreatedMetadataResult {
  const preview = previewOverride || validateDraft(draft);

  const heroExt = getFileExtension(draft.hero.name);
  const thumbExt = getFileExtension(draft.thumbnail.name);
  const heroName = `hero${heroExt}`;
  const thumbnailName = `thumbnail${thumbExt}`;

  const publishedAt =
    publishedAtOverride ||
    new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const display: Record<string, { name: string; summary: string }> = {};
  const sortedLocales = Object.keys(draft.translations).sort();
  for (const locale of sortedLocales) {
    const t = draft.translations[locale];
    display[locale] = {
      name: t.name.trim(),
      summary: t.summary.trim(),
    };
  }

  const document: GameReleaseSourceDocument = {
    gameId: draft.gameId.trim(),
    version: draft.version.trim(),
    minimumLauncherVersion: draft.minimumLauncherVersion.trim(),
    publishedAt,
    engine: draft.engine,
    entrypoint: preview.entrypoint,
    workingDirectory: preview.workingDirectory,
    saveDirectoryName: draft.saveDirectoryName.trim(),
    display,
    hero: heroName,
    heroFocalPoint: {
      x: draft.focalPoint?.x ?? 0.5,
      y: draft.focalPoint?.y ?? 0.5,
    },
    thumbnail: thumbnailName,
  };

  const validation = validateGameReleaseSourceSchema(document);
  if (!validation.valid) {
    throw new ArtifactValidationError(
      `生成されたrelease.jsonがスキーマを満たしていません:\n・${validation.errors.join("\n・")}`,
      validation.errors,
    );
  }

  const jsonString = JSON.stringify(document, null, 2) + "\n";
  const releaseJsonBytes = new TextEncoder().encode(jsonString);

  return {
    document,
    releaseJsonBytes,
    heroFile: {
      name: heroName,
      archivePath: `metadata/${heroName}`,
      file: draft.hero,
    },
    thumbnailFile: {
      name: thumbnailName,
      archivePath: `metadata/${thumbnailName}`,
      file: draft.thumbnail,
    },
    preview,
  };
}
