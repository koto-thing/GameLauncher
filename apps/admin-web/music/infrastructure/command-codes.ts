import type { Principal } from "../../../music/src/domain/models";
import type {
  CommandReservations,
  CommandRandom,
} from "../application/command-codes";

/** @brief 現在権限と曲の存在をSQLでも検査し、一意衝突だけを無視する。 */
export class D1CommandReservations implements CommandReservations {
  /** @brief 既存D1 bindingを使う。 */
  constructor(private db: D1Database) {}

  /** @brief 削除後も残る割当履歴を読む。 */
  async find(trackId: string): Promise<number | null> {
    const row = await this.db
      .prepare(
        "SELECT code_id FROM music_command_codes WHERE version=1 AND track_id=?",
      )
      .bind(trackId)
      .first<{ code_id: number }>();
    return row?.code_id ?? null;
  }

  /** @brief 原子的INSERTで競合を解決する。事前SELECTを一意性の保証に使わない。 */
  async reserve(
    trackId: string,
    candidate: number,
    actor: Principal,
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO music_command_codes(version,code_id,track_id,created_at)
      SELECT 1,?,t.id,? FROM music_tracks t WHERE t.id=? AND EXISTS(
        SELECT 1 FROM music_accounts a WHERE a.id=? AND (a.admin=1 OR EXISTS(
          SELECT 1 FROM music_memberships m WHERE m.account_id=a.id AND m.game_id=t.game_id)))
      ON CONFLICT DO NOTHING`,
      )
      .bind(candidate, Date.now(), trackId, actor.id)
      .run();
  }
}

/** @brief CSPRNGの3バイトから偏りのない24ビットを作る。 */
export class CryptoCommandRandom implements CommandRandom {
  /** @brief UUIDや曲名を切り詰めず共有ID専用の乱数を生成する。 */
  next(): number {
    const bytes = crypto.getRandomValues(new Uint8Array(3));
    return (bytes[0] << 16) | (bytes[1] << 8) | bytes[2];
  }
}
