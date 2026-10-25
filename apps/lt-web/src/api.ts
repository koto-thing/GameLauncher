import type { ApiError } from "../../../contracts/lt/v1";
const messages: Record<string, string> = {
  UNAUTHENTICATED: "セッションがありません。メール確認から再開してください。",
  FORBIDDEN: "この操作は許可されていません。",
  VERSION_CONFLICT: "状態が変更されました。再読み込みして内容を確認してください。",
  RETENTION_EXPIRED: "データの保持期限が終了しました。",
  TOKEN_INVALID: "確認リンクが無効、使用済み、または期限切れです。",
  RATE_LIMITED: "時間をおいて再度操作してください。",
};
/** 同一オリジンの API を呼び、サーバーの認証・状態エラーを保持する */
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/lt/v1${path}`, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  // HTTP エラーを成功へ置き換えない
  if (!response.ok) {
    let body: ApiError;
    try {
      body = (await response.json()) as ApiError;
    } catch {
      throw new Error(`API に接続できません (HTTP ${response.status})`);
    }
    if (!body?.error?.code) throw new Error(`API エラー (HTTP ${response.status})`);
    throw new Error(
      `${messages[body.error.code] ?? body.error.code} (${body.error.requestId})${body.error.fields?.map((f) => ` ${f.path}: ${f.code}`).join("") ?? ""}`,
    );
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}
