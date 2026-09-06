import { getD1 } from "@/db/initialize";
import { env } from "cloudflare:workers";
import { MusicService } from "../../../music/src/application/music-service";
import { DOMAIN_POLICY_DEFAULTS } from "../../../music/src/config/domain-policy.defaults";
import { PLAYER_RUNTIME_DEFAULTS } from "../../../music/src/config/player-runtime.defaults";
import { MusicError } from "../../../music/src/domain/models";
import { musicSettings } from "../config/settings";
import { RentalBridge } from "../infrastructure/bridge";
import { D1MusicRepository } from "../infrastructure/repository";
import {
  D1Publications,
  RentalPublisher,
} from "../infrastructure/publications";
import { Publications } from "../application/publications";
import { Uploads } from "../application/uploads";
import { D1Uploads, RentalAssetStorage } from "../infrastructure/uploads";

/** @brief Music入口だけで依存を組み立て、未設定をゲームへ波及させない。 @returns リクエスト専用Use Case。 */
export function musicServices() {
  const settings = musicSettings(env as Record<string, unknown>);
  const db = getD1();
  const repository = new D1MusicRepository(db);
  const bridge = new RentalBridge(settings);
  const operations = new D1Publications(db);
  const publications = new Publications(
    operations,
    new RentalPublisher(bridge),
    repository,
  );
  const storage = new RentalAssetStorage(bridge);
  const music = new MusicService(
    repository,
    publications,
    DOMAIN_POLICY_DEFAULTS,
    { now: /** @brief 監査時刻を取得する。 */ () => Date.now() },
    {
      next: /** @brief サーバー生成UUIDを割り当てる。 */ () =>
        crypto.randomUUID(),
    },
    PLAYER_RUNTIME_DEFAULTS,
    {
      /** @brief リポジトリ条件なしでGitHubの安定数値IDだけを確認する。 @param id 割り当て先ID。 @returns 本人情報。 */
      async findById(id: string) {
        // 隔離ローカル環境の既知fixtureは実在GitHubユーザーとして照会しない。
        if (settings.environment === "local") {
          const local = await db
            .prepare("SELECT id,login FROM music_accounts WHERE id=?")
            .bind(id)
            .first<{ id: string; login: string }>();
          if (local) return local;
        }
        const response = await fetch(`https://api.github.com/user/${id}`, {
          headers: {
            accept: "application/vnd.github+json",
            "user-agent": "PandD-Music",
          },
          redirect: "error",
        });
        if (!response.ok)
          throw new MusicError("UNAVAILABLE", "GitHub IDを確認できません。");
        const value = (await response.json()) as { id: number; login: string };
        if (String(value.id) !== id)
          throw new MusicError("INVALID", "GitHub IDが一致しません。");
        return { id, login: value.login };
      },
    },
  );
  return {
    db,
    repository,
    operations,
    publications,
    music,
    storage,
    uploads: new Uploads(
      new D1Uploads(repository),
      storage,
      DOMAIN_POLICY_DEFAULTS,
    ),
    policy: DOMAIN_POLICY_DEFAULTS,
  };
}
