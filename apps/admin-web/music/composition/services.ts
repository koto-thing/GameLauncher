import { getD1 } from "@/db/initialize";
import { env } from "cloudflare:workers";
import { MusicService } from "../../../music/src/application/music-service";
import { DOMAIN_POLICY_DEFAULTS } from "../../../music/src/config/domain-policy.defaults";
import { PLAYER_RUNTIME_DEFAULTS } from "../../../music/src/config/player-runtime.defaults";
import { musicSettings } from "../config/settings";
import { RentalBridge } from "../infrastructure/bridge";
import { D1MusicRepository } from "../infrastructure/repository";
import {
  D1Publications,
  RentalPublisher,
} from "../infrastructure/publications";
import { Publications } from "../application/publications";
import { Uploads } from "../application/uploads";
import { IssueCommandCode } from "../application/command-codes";
import { D1CommandReservations, CryptoCommandRandom } from "../infrastructure/command-codes";
import { D1Uploads, RentalAssetStorage } from "../infrastructure/uploads";

/** @brief Music入口だけで依存を組み立て、未設定をゲームへ波及させない。 @returns リクエスト専用Use Case。 */
export function musicServices() {
  const settings = musicSettings(env as Record<string, unknown>);
  const db = getD1();

  const repository = new D1MusicRepository(db);
  const bridge = new RentalBridge(settings);
  const operations = new D1Publications(db);
  const codes = new IssueCommandCode(new D1CommandReservations(db), new CryptoCommandRandom());

  const publications = new Publications(
    operations,
    new RentalPublisher(bridge),
    repository,
    codes,
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
  );

  return {
    db,
    codes,
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
