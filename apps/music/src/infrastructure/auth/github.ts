import type { IdentityProvider } from "../../application/ports";
import type { ServerConfig } from "../../config/server-config";
import { MusicError } from "../../domain/models";

/** @brief プロバイダーからの応答も小さく制限し、想定外の本文をメモリへ展開しない。 */
async function providerJson<T>(response: Response): Promise<T> {
  const reader = response.body?.getReader();
  if (!reader)
    throw new MusicError("UNAVAILABLE", "GitHubの応答本文がありません。");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 64 * 1024)
        throw new MusicError(
          "UNAVAILABLE",
          "GitHubの応答が想定容量を超えています。",
        );
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(body)) as T;
}

/** @brief GitHub OAuthだけを担当し、サイトの投稿権限を決めない。 */
export class GitHubIdentity implements IdentityProvider {
  /** @brief 固定callbackとクライアント秘密をサーバー設定から受け取る。 */
  constructor(private readonly config: ServerConfig) {}
  /** @brief PKCE付きコード交換後にGitHubの安定IDを再取得する。 */
  async exchange(
    code: string,
    verifier: string,
  ): Promise<{ id: string; login: string }> {
    const response = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        redirect: "error",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: this.config.githubClientId,
          client_secret: this.config.githubClientSecret,
          code,
          code_verifier: verifier,
          redirect_uri: `${this.config.origin}/api/auth/callback`,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok)
      throw new MusicError("UNAVAILABLE", "GitHub認証に接続できません。");
    const token = await providerJson<{ access_token?: string }>(response);
    if (!token.access_token)
      throw new MusicError(
        "UNAUTHENTICATED",
        "GitHub認証が取り消されたか期限切れです。",
      );
    // 最小スコープのトークンはこのリクエストでだけ使用し、DBやクライアントには保存しない。
    const user = await fetch("https://api.github.com/user", {
      redirect: "error",
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "PandD-Music",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!user.ok)
      throw new MusicError(
        "UNAUTHENTICATED",
        "GitHubユーザー情報を確認できません。",
      );
    const value = await providerJson<{ id?: number; login?: string }>(user);
    if (!Number.isSafeInteger(value.id) || !value.login)
      throw new MusicError("UNAUTHENTICATED", "GitHubの応答が不正です。");
    return { id: String(value.id), login: value.login };
  }
}
