import type { ApiError } from '../../../contracts/lt/v1';

/** 同一オリジンの API を呼び、サーバーの認証・状態エラーを保持する */
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/lt/v1${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });

  // 失敗を成功値に置き換えない
  if (!response.ok) {
    const body = await response.json() as ApiError;
    throw new Error(`${body.error.code} (${body.error.requestId})`);
  }

  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
