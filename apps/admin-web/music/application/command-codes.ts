import type { Principal } from "../../../music/src/domain/models";
import { MusicError } from "../../../music/src/domain/models";
import { validateCodeId } from "../../../music/src/domain/command-code";

export interface CommandReservations {
  find(trackId: string): Promise<number | null>;
  reserve(trackId: string, candidate: number, actor: Principal): Promise<void>;
}

export interface CommandRandom {
  next(): number;
}
/** @brief 衝突時だけ上限付きで再試行し、並行した同一曲の発行を同じ予約へ収束させる。 */
export class IssueCommandCode {
  /** @brief 保存と暗号学的乱数の境界を注入する。 */
  constructor(
    private reservations: CommandReservations,
    private random: CommandRandom,
  ) {}

  /** @brief 認可済み管理画面から既存予約を確認し、閲覧だけでは発行しない。 */
  async find(trackId: string): Promise<number | null> {
    return this.reservations.find(trackId);
  }

  /** @brief 同じ曲のコードを再発行せず取得する。呼出前に現在の曲権限を検証する。 */
  async issue(trackId: string, actor: Principal): Promise<number> {
    const existing = await this.reservations.find(trackId);
    if (existing !== null) return existing;
    for (let attempt = 0; attempt < 32; attempt++) {
      const candidate = this.random.next();
      validateCodeId(candidate);
      await this.reservations.reserve(trackId, candidate, actor);
      const result = await this.reservations.find(trackId);
      if (result !== null) return result;
    }
    throw new MusicError(
      "UNAVAILABLE",
      "コードの予約が混み合っています。再試行してください。",
    );
  }
}
