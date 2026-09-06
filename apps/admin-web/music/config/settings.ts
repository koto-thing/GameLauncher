import { MusicError } from "../../../music/src/domain/models";

// 接続値は管理専用。公開bundleからこのモジュールを参照しない。
export const MUSIC_RUNTIME = {
  jsonMaxBytes: 1048576,
  uploadPerMinute: 20,
  mutationPerMinute: 120,
  bridgeTimeoutMs: 120000,
  signatureSeconds: 120,
} as const;
export interface MusicSettings {
  bridgeUrl: string;
  keyId: string;
  secret: string;
  environment: string;
}

/** @brief Musicが有効な入口だけで秘密と固定HTTPS接続先を検証する。 @param values Worker設定。 @returns 管理専用の設定。 */
export function musicSettings(values: Record<string, unknown>): MusicSettings {
  if (values.MUSIC_ENABLED !== "true")
    throw new MusicError("UNAVAILABLE", "Music管理は無効です。");
  const environment = String(values.MUSIC_ENVIRONMENT ?? "production");
  const bridgeUrl = String(values.MUSIC_BRIDGE_URL ?? "");
  let url: URL;
  try {
    url = new URL(bridgeUrl);
  } catch {
    throw new MusicError("UNAVAILABLE", "Music配信サーバーの設定待ちです。");
  }
  const local =
    environment === "local" &&
    ["localhost", "127.0.0.1"].includes(url.hostname);
  if (
    (!local && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith("/bridge.php")
  )
    throw new MusicError(
      "UNAVAILABLE",
      "Music配信サーバーの接続設定が不正です。",
    );
  const secret = String(values.MUSIC_BRIDGE_SECRET ?? "");
  if (secret.length < 32)
    throw new MusicError("UNAVAILABLE", "Music専用連携鍵の設定待ちです。");
  return {
    bridgeUrl,
    secret,
    environment,
    keyId: String(values.MUSIC_BRIDGE_KEY_ID ?? "primary"),
  };
}
