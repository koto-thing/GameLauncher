import { MusicError } from "../domain/models";

export interface ServerConfig {
  origin: string;
  environment: string;
  contactUrl: string;
  githubClientId: string;
  githubClientSecret: string;
  bootstrapAdminIds: string[];
  sessionSeconds: number;
  flowSeconds: number;
  authPerMinute: number;
  uploadPerMinute: number;
  mutationPerMinute: number;
  jsonMaxBytes: number;
}
export type MusicEnv = Env & {
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  BOOTSTRAP_ADMIN_IDS?: string;
};

/** @brief 環境値を一度検証して秘密をサーバー側だけに保持する。 @param env WorkerのBindings。 @returns 型付き設定。 */
export function serverConfig(env: MusicEnv): ServerConfig {
  const origin = env.SITE_ORIGIN;
  const url = new URL(origin);
  const local =
    env.ENVIRONMENT === "local" &&
    ["localhost", "127.0.0.1"].includes(url.hostname);
  // 本番の未設定URLやHTTPを安全な失敗にし、ローカル認証を暗黙に有効化しない。
  if (
    url.origin !== origin ||
    (!local && (url.protocol !== "https:" || url.hostname.endsWith(".invalid")))
  )
    throw new MusicError(
      "UNAVAILABLE",
      "サイトの公開先設定が完了していません。",
    );
  return {
    origin,
    environment: env.ENVIRONMENT,
    contactUrl: env.CONTACT_URL,
    githubClientId: env.GITHUB_CLIENT_ID ?? "",
    githubClientSecret: env.GITHUB_CLIENT_SECRET ?? "",
    bootstrapAdminIds: (env.BOOTSTRAP_ADMIN_IDS ?? "")
      .split(",")
      .map(/** @brief 安定した数値IDの前後空白を取り除く。 */ (id) => id.trim())
      .filter(
        /** @brief GitHubログイン名による管理者付与を禁止する。 */ (id) =>
          /^\d+$/.test(id),
      ),
    sessionSeconds: 8 * 60 * 60,
    flowSeconds: 600,
    authPerMinute: 10,
    uploadPerMinute: 20,
    mutationPerMinute: 120,
    jsonMaxBytes: 32 * 1024,
  };
}
