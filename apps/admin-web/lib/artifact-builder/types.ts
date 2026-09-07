import type { ArtifactDescriptor } from "../artifact-limits.ts";

// Artifact生成で扱う入力、進捗、出力の共有型
export type SupportedEngine = "unity" | "godot" | "siv3d";

export type Translation = {
  name: string;
  summary: string;
};

export type FocalPoint = {
  x: number;
  y: number;
};

export type BuildInputFile = {
  name: string;
  size: number;
  relativePath: string; // e.g. "MyGame.exe" or "MyGame_Data/globalgamemanagers" (relative to build root)
  slice: (start?: number, end?: number) => Blob;
  stream?: () => ReadableStream<Uint8Array>;
  arrayBuffer?: () => Promise<ArrayBuffer>;
};

export type ImageInputFile = {
  name: string;
  size: number;
  slice: (start?: number, end?: number) => Blob;
  arrayBuffer?: () => Promise<ArrayBuffer>;
};

export type ReleaseDraft = {
  gameId: string;
  version: string;
  minimumLauncherVersion: string;
  engine: SupportedEngine | string;
  saveDirectoryName: string;
  translations: Record<string, Translation>;
  hero: ImageInputFile;
  thumbnail: ImageInputFile;
  focalPoint?: FocalPoint;
  buildFiles: BuildInputFile[];
  entrypointRelativePath: string; // relative to build root, e.g. "MyGame.exe" or "bin/MyGame.exe"
};

export type ReleasePreview = {
  files: number;
  totalBytes: number;
  entrypoint: string; // relative to artifact root, e.g. "build/MyGame.exe"
  workingDirectory: string; // relative to artifact root, e.g. "build" or "build/bin"
  locales: string[];
};

export type ArtifactBuildProgress = {
  stage: "validating" | "metadata" | "zipping" | "hashing" | "completed";
  stageText: string;
  detailText: string;
  percent: number;
  completedBytes?: number;
  totalBytes?: number;
  currentFile?: string;
};

export type ArtifactBuildResult = {
  artifactId: string;
  artifactFile: string;
  descriptor: ArtifactDescriptor;
  zipBlob: Blob;
  sha256: string;
  sizeBytes: number;
  fileCount: number;
};

export class ArtifactBuildCancelledError extends Error {
  /** ユーザー操作によるArtifact生成キャンセルを表す */
  constructor(message: string = "Artifactの作成をキャンセルしました") {
    super(message);
    this.name = "ArtifactBuildCancelledError";
  }
}

export class ArtifactValidationError extends Error {
  readonly details?: string[];

  /** 入力検証の詳細エラーを保持する */
  constructor(message: string, details?: string[]) {
    super(message);
    this.name = "ArtifactValidationError";
    this.details = details;
  }
}
