import { hashFileInChunks } from "../../../../admin-web/lib/sha256-stream";
import { MANAGER_RUNTIME_DEFAULTS } from "../../config/manager-runtime.defaults";

/** @brief APIの入力項目別エラーをUIまで保持する。 */
export class ApiError extends Error {
  /** @brief エラーコードと該当項目を記録する。 */
  constructor(
    message: string,
    public readonly code: string,
    public readonly field?: string,
  ) {
    super(message);
  }
}
/** @brief HTTP失敗を一貫した復旧可能なエラーへ変換する。 */
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; csrf?: string } = {},
): Promise<T> {
  const response = await fetch(
    path === "/auth/logout" ? "/api/auth/logout" : `/api/music${path}`,
    {
      method: options.method ?? "GET",
      headers: {
        ...(options.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        ...(options.csrf ? { "X-CSRF-Token": options.csrf } : {}),
      },
      body:
        options.body !== undefined ? JSON.stringify(options.body) : undefined,
    },
  );
  if (response.status === 204) return undefined as T;
  const value = (await response.json()) as T & {
    code?: string;
    message?: string;
    field?: string;
  };
  if (!response.ok)
    throw new ApiError(
      value.message ?? "通信に失敗しました。再試行してください。",
      value.code ?? "NETWORK",
      value.field,
    );
  return value;
}
/** @brief 実送信進捗を表示し、同じ素材IDへの再送を行わない。 */
export async function uploadFile<T>(
  gameId: string,
  kind: "audio" | "image",
  file: File,
  csrf: string,
  progress: (percent: number) => void,
): Promise<T> {
  const digest = await hashFileInChunks(file);
  const key = `${gameId}:${kind}:${digest}`;
  const mime =
    file.type === "audio/x-wav" || file.name.toLowerCase().endsWith(".wav")
      ? "audio/wav"
      : file.type;
  let upload = pendingUploads.get(key);
  if (!upload) {
    upload = await api<{ id: string; assetId: string }>("/uploads", {
      method: "POST",
      body: { gameId, kind, bytes: file.size, digest, mime },
      csrf,
    });
    pendingUploads.set(key, upload);
  }
  const uploadId = upload.id;
  return new Promise(
    /** @brief XHRの進捗と最終検証結果をPromiseへ接続する。 */ (
      resolve,
      reject,
    ) => {
      const request = new XMLHttpRequest();
      request.open("PUT", `/api/music/uploads/${uploadId}`);
      request.timeout = MANAGER_RUNTIME_DEFAULTS.uploadTimeoutMs;
      request.setRequestHeader("X-CSRF-Token", csrf);
      request.setRequestHeader("Content-Type", "application/octet-stream");
      request.upload.onprogress =
        /** @brief 送信完了後もサーバー検証待ちを表示できるよう進捗だけ更新する。 */ (
          event,
        ) => {
          if (event.lengthComputable)
            progress(Math.round((event.loaded / event.total) * 100));
        };
      request.onerror =
        /** @brief 失敗後も元upload IDで再試行できるよう記録を残す。 */ () =>
          reject(
            new ApiError(
              "アップロードに失敗しました。ファイルを選び直して再試行してください。",
              "NETWORK",
            ),
          );
      request.ontimeout = request.onerror;
      request.onabort = request.onerror;
      request.onload =
        /** @brief サーバー側の素材検証失敗を成功扱いにしない。 */ () => {
          try {
            const value = JSON.parse(request.responseText) as T & {
              message?: string;
              code?: string;
            };
            if (request.status >= 200 && request.status < 300) {
              pendingUploads.delete(key);
              resolve(value);
            } else
              reject(
                new ApiError(
                  value.message ?? "アップロードに失敗しました。",
                  value.code ?? "INVALID",
                ),
              );
          } catch {
            reject(
              new ApiError(
                "応答を読み取れません。再試行してください。",
                "NETWORK",
              ),
            );
          }
        };
      request.send(file);
    },
  );
}

// 通信失敗・D1確認失敗でも同じファイルの再試行は同じupload IDを使用する。
const pendingUploads = new Map<string, { id: string; assetId: string }>();
