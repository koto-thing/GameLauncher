import { MusicService } from "../application/music-service";
import { AuthService } from "../application/auth-service";
import { DOMAIN_POLICY_DEFAULTS } from "../config/domain-policy.defaults";
import { PLAYER_RUNTIME_DEFAULTS } from "../config/player-runtime.defaults";
import { serverConfig, type MusicEnv } from "../config/server-config";
import { D1MusicRepository } from "../infrastructure/persistence/d1-repository";
import { R2AssetStorage } from "../infrastructure/storage/r2-storage";
import { D1AuthStore } from "../infrastructure/auth/d1-auth-store";
import { GitHubIdentity } from "../infrastructure/auth/github";
import {
  equalToken,
  hashToken,
  randomToken,
} from "../infrastructure/auth/crypto";
import { createApi, type Services } from "../presentation/api/router";

/** @brief 環境固有の実装をComposition Rootでだけ生成・注入する。 */
export function compose(env: MusicEnv): Services {
  const config = serverConfig(env);
  const clock = { now: Date.now };
  return {
    config,
    music: new MusicService(
      new D1MusicRepository(env.MUSIC_DB),
      new R2AssetStorage(env.MUSIC_ASSETS),
      DOMAIN_POLICY_DEFAULTS,
      clock,
      { next: randomTokenId },
      PLAYER_RUNTIME_DEFAULTS,
    ),
    auth: new AuthService(
      new D1AuthStore(env.MUSIC_DB),
      new GitHubIdentity(config),
      { random: randomToken, hash: hashToken, equal: equalToken },
      clock,
      {
        ...config,
        configured: Boolean(config.githubClientId && config.githubClientSecret),
      },
    ),
  };
}
/** @brief ファイル名と無関係な不変の素材・レコードIDを作る。 */
function randomTokenId(): string {
  return crypto.randomUUID();
}
const api = createApi(compose);
export default {
  /** @brief 公開静的ページと常にWorkerを通るAPIを振り分ける。 */
  async fetch(
    request: Request,
    env: MusicEnv,
    context: ExecutionContext,
  ): Promise<Response> {
    return new URL(request.url).pathname.startsWith("/api/")
      ? api.fetch(request, env, context)
      : env.ASSETS.fetch(request);
  },
};
