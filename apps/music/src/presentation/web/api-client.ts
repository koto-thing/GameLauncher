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
  const response = await fetch(`/api${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...(options.csrf ? { "X-CSRF-Token": options.csrf } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
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
export function uploadFile<T>(
  gameId: string,
  kind: "audio" | "image",
  file: File,
  csrf: string,
  progress: (percent: number) => void,
): Promise<T> {
  return new Promise(
    /** @brief XHRの進捗と最終検証結果をPromiseへ接続する。 */ (
      resolve,
      reject,
    ) => {
      const request = new XMLHttpRequest();
      request.open("POST", `/api/manage/games/${gameId}/assets/${kind}`);
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
        /** @brief 失敗後は新しいアップロードとして再試行する。 */ () =>
          reject(
            new ApiError(
              "アップロードに失敗しました。ファイルを選び直して再試行してください。",
              "NETWORK",
            ),
          );
      request.onload =
        /** @brief サーバー側の素材検証失敗を成功扱いにしない。 */ () => {
          try {
            const value = JSON.parse(request.responseText) as T & {
              message?: string;
              code?: string;
            };
            if (request.status >= 200 && request.status < 300) resolve(value);
            else
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
