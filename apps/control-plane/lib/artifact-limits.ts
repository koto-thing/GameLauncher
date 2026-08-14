export const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024 * 1024; // 5 GiB
export const MAX_ARTIFACT_FILES = 50_000;
export const INTAKE_PART_SIZE = 64 * 1024 * 1024; // 64 MiB
export const PRESIGNED_URL_SECONDS = 15 * 60; // 15 minutes

export type ArtifactDescriptor = {
  schemaVersion: number;
  artifactId: string;
  artifactFile: string;
  gameId: string;
  version: string;
  platform: string;
  arch: string;
  sizeBytes: number;
  fileCount: number;
  sha256: string;
  createdAt: string;
};
