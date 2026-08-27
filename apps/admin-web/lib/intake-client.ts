import type { ArtifactDescriptor } from "./artifact-limits.ts";
import { validateDescriptorSchema } from "./descriptor-validator.ts";
import { hashFileInChunks } from "./sha256-stream.ts";

export type UploadProgressCallback = (
  percent: number,
  stage: string,
  detail: string,
  uploadedParts: number,
  totalParts: number,
) => void;

export type UploadOptions = {
  onProgress?: UploadProgressCallback;
  signal?: AbortSignal;
  maxConcurrency?: number;
  fetch?: typeof fetch;
};

export type UploadResult = {
  artifactId: string;
  state: string;
  descriptor: ArtifactDescriptor;
};

export class IntakeClientError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
    this.name = "IntakeClientError";
  }
}

export class IntakeCancelledError extends IntakeClientError {
  constructor(message: string = "アップロードがキャンセルされました") {
    super(message);
    this.name = "IntakeCancelledError";
  }
}

/**
 * Validate descriptor JSON and verify consistency with the selected ZIP file.
 */
export async function validateDescriptorAndZip(
  descriptorRaw: unknown,
  zipFile: File,
): Promise<{ descriptor: ArtifactDescriptor }> {
  const validation = validateDescriptorSchema(descriptorRaw);
  if (!validation.valid) {
    throw new IntakeClientError(
      `descriptorの形式が不正です:\n・${validation.errors.join("\n・")}`,
    );
  }

  const descriptor = validation.descriptor;

  if (zipFile.name !== descriptor.artifactFile) {
    throw new IntakeClientError(
      `選択したZIPファイル名 (${zipFile.name}) がdescriptorの指定 (${descriptor.artifactFile}) と一致しません`,
    );
  }

  if (zipFile.size !== descriptor.sizeBytes) {
    const expectedMiB = (descriptor.sizeBytes / (1024 * 1024)).toFixed(1);
    const actualMiB = (zipFile.size / (1024 * 1024)).toFixed(1);
    throw new IntakeClientError(
      `ZIPファイルの容量 (${actualMiB} MiB) がdescriptorの指定 (${expectedMiB} MiB) と一致しません`,
    );
  }

  return { descriptor };
}

/**
 * Calculate SHA-256 of the ZIP file in chunks and verify against the descriptor.
 */
export async function verifyZipSha256(
  descriptor: ArtifactDescriptor,
  zipFile: Blob,
  onProgress?: (percent: number, processedBytes: number, totalBytes: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  const calculatedSha256 = await hashFileInChunks(
    zipFile,
    (processed, total) => {
      const pct = total > 0 ? Math.round((processed / total) * 100) : 100;
      onProgress?.(pct, processed, total);
    },
    signal,
  );

  if (calculatedSha256.toLowerCase() !== descriptor.sha256.toLowerCase()) {
    throw new IntakeClientError(
      `SHA-256ハッシュが一致しません。\n期待値: ${descriptor.sha256}\n計算値: ${calculatedSha256}`,
    );
  }

  return calculatedSha256;
}

function isAbortError(error: unknown): boolean {
  if (error instanceof IntakeCancelledError) {
    return true;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  ) {
    return true;
  }
  return false;
}

async function fetchJson<T>(
  url: string,
  init?: RequestInit,
  clientFetch: typeof fetch = globalThis.fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await clientFetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        ...init?.headers,
      },
    });
  } catch (error) {
    if (isAbortError(error) || init?.signal?.aborted) {
      throw new IntakeCancelledError();
    }
    throw new IntakeClientError("サーバーへの通信に失敗しました");
  }

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      // Ignore JSON parse error
    }
    if (response.status === 401) {
      throw new IntakeClientError("ログインが必要です。GitHubでログインしてください", 401);
    }
    if (response.status === 403) {
      throw new IntakeClientError(message || "操作が許可されていません", 403);
    }
    throw new IntakeClientError(message, response.status);
  }

  return (await response.json()) as T;
}

/**
 * Upload an artifact to private intake using multipart chunked upload.
 */
export async function uploadArtifact(
  descriptor: ArtifactDescriptor,
  zipFile: File,
  options: UploadOptions = {},
): Promise<UploadResult> {
  const { onProgress, signal, maxConcurrency = 4, fetch: clientFetch = globalThis.fetch } = options;

  const checkCancel = () => {
    if (signal?.aborted) {
      throw new IntakeCancelledError();
    }
  };

  checkCancel();

  onProgress?.(
    88,
    "upload sessionを作成しています",
    `artifact ${descriptor.artifactId.slice(0, 8)} のセッションを初期化中…`,
    0,
    1,
  );

  type SessionResponse = {
    artifactId: string;
    partSize: number;
    partCount: number;
    state: string;
    expiresAt: string;
    uploadedParts: number[];
  };

  const session = await fetchJson<SessionResponse>(
    "/api/intake/uploads",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(descriptor),
      signal,
    },
    clientFetch,
  );

  try {
    checkCancel();

    const partSize = session.partSize;
    const partCount = session.partCount;
    const uploaded = new Set<number>(session.uploadedParts);
    const pending: number[] = [];

    for (let i = 1; i <= partCount; i += 1) {
      if (!uploaded.has(i)) {
        pending.push(i);
      }
    }

    onProgress?.(
      90,
      "非公開intakeへuploadしています",
      `${uploaded.size} / ${partCount} parts 完了`,
      uploaded.size,
      partCount,
    );

    type IssuePartsResponse = {
      transport: "direct-r2" | "worker-proxy";
      expiresIn: number;
      parts: { partNumber: number; url: string }[];
    };

    // Upload in concurrent batches
    for (let offset = 0; offset < pending.length; offset += maxConcurrency) {
      checkCancel();
      const batch = pending.slice(offset, offset + maxConcurrency);

      const signed = await fetchJson<IssuePartsResponse>(
        `/api/intake/uploads/${encodeURIComponent(descriptor.artifactId)}/parts`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ partNumbers: batch }),
          signal,
        },
        clientFetch,
      );

      const transport = signed.transport;
      const urlMap = new Map(signed.parts.map((p) => [p.partNumber, p.url]));

      await Promise.all(
        batch.map(async (partNumber) => {
          const url = urlMap.get(partNumber);
          if (!url) throw new IntakeClientError(`part ${partNumber} のURLが取得できませんでした`);

          const start = (partNumber - 1) * partSize;
          const end = Math.min(zipFile.size, start + partSize);
          const blob = zipFile.slice(start, end);
          const sizeBytes = blob.size;

          let lastError: Error | null = null;
          let etag = "";

          // Retry up to 3 attempts with exponential backoff
          for (let attempt = 0; attempt < 3; attempt += 1) {
            checkCancel();
            try {
              // Note: In browser fetch, do not set forbidden header "Content-Length".
              // Browser sets Content-Length automatically for Blob bodies.
              const putResponse = await clientFetch(url, {
                method: "PUT",
                body: blob,
                signal,
              });

              if (!putResponse.ok) {
                throw new Error(`HTTP ${putResponse.status}`);
              }

              if (transport === "worker-proxy") {
                const workerResult = (await putResponse.json()) as { etag: string };
                etag = workerResult.etag;
              } else {
                const rawEtag = putResponse.headers.get("etag") || putResponse.headers.get("ETag");
                etag = (rawEtag || "").replace(/^"(.*)"$/, "$1").trim();
                if (!etag) {
                  throw new Error(
                    "R2がpart ETagを返しませんでした (CORS ExposeHeadersの設定を確認してください)",
                  );
                }
              }

              // Success
              lastError = null;
              break;
            } catch (err) {
              if (isAbortError(err) || signal?.aborted) {
                throw new IntakeCancelledError();
              }
              lastError = err instanceof Error ? err : new Error(String(err));
              if (attempt < 2) {
                await new Promise((r) => setTimeout(r, 100 * Math.pow(2, attempt)));
              }
            }
          }

          if (lastError) {
            throw new IntakeClientError(
              `part ${partNumber} のuploadに失敗しました (${lastError.message})`,
            );
          }

          if (transport === "direct-r2") {
            await fetchJson(
              `/api/intake/uploads/${encodeURIComponent(descriptor.artifactId)}/parts`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  completed: { partNumber, etag, sizeBytes },
                }),
                signal,
              },
              clientFetch,
            );
          }

          uploaded.add(partNumber);
          const ratio = partCount > 0 ? uploaded.size / partCount : 1;
          onProgress?.(
            90 + Math.round(ratio * 8),
            "非公開intakeへuploadしています",
            `${uploaded.size} / ${partCount} parts 完了`,
            uploaded.size,
            partCount,
          );
        }),
      );
    }

    checkCancel();

    onProgress?.(
      99,
      "artifactをsealしています",
      "R2 objectの容量とpart一覧を検証しています…",
      partCount,
      partCount,
    );

    const sealed = await fetchJson<{ artifactId: string; state: string }>(
      `/api/intake/uploads/${encodeURIComponent(descriptor.artifactId)}/seal`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        signal,
      },
      clientFetch,
    );

    onProgress?.(
      100,
      "intake uploadが完了しました",
      "Webアプリから申請を作成できます",
      partCount,
      partCount,
    );

    return {
      artifactId: descriptor.artifactId,
      state: sealed.state,
      descriptor,
    };
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) {
      try {
        await clientFetch(`/api/intake/uploads/${encodeURIComponent(descriptor.artifactId)}`, {
          method: "DELETE",
        });
      } catch {
        // Ignore failure on delete during cancel
      }
      throw new IntakeCancelledError();
    }
    throw err;
  }
}
