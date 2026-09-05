import type { MusicRepository } from "../../application/ports";
import {
  MusicError,
  type Account,
  type Advertisement,
  type Asset,
  type AuditEntry,
  type Game,
  type GameContent,
  type Principal,
  type Track,
  type TrackContent,
} from "../../domain/models";

interface GameRow {
  id: string;
  version: number;
  draft: string;
  published: string | null;
  suspended: number;
}
interface TrackRow {
  id: string;
  game_id: string;
  version: number;
  position: number;
  published_position: number | null;
  draft: string;
  published: string | null;
}
interface AssetRow {
  id: string;
  game_id: string;
  object_key: string;
  kind: Asset["kind"];
  mime: string;
  bytes: number;
  status: Asset["status"];
  duration_seconds: number | null;
  sample_rate_hz: number | null;
  channels: number | null;
  width_pixels: number | null;
  height_pixels: number | null;
  created_at: number;
}
// 保存直前の権限もSQLで再評価し、認可後に担当解除された書き込みを防ぐ。
const EDIT =
  "EXISTS(SELECT 1 FROM accounts a WHERE a.id=? AND (a.admin=1 OR EXISTS(SELECT 1 FROM memberships m WHERE m.account_id=a.id AND m.game_id=?)))";
const ADMIN = "EXISTS(SELECT 1 FROM accounts WHERE id=? AND admin=1)";

/** @brief D1行を作品へ変換する。 */
function decodeGame(row: GameRow): Game {
  return {
    id: row.id,
    version: row.version,
    draft: JSON.parse(row.draft) as GameContent,
    published: row.published
      ? (JSON.parse(row.published) as GameContent)
      : null,
    suspended: row.suspended === 1,
  };
}
/** @brief D1行を曲へ変換する。 */
function decodeTrack(row: TrackRow): Track {
  return {
    id: row.id,
    gameId: row.game_id,
    version: row.version,
    position: row.position,
    publishedPosition: row.published_position,
    draft: JSON.parse(row.draft) as TrackContent,
    published: row.published
      ? (JSON.parse(row.published) as TrackContent)
      : null,
  };
}
/** @brief 影響行数ゼロを成功として扱わない。 */
function changed(result: D1Result): void {
  if (result.meta.changes < 1)
    throw new MusicError(
      "CONFLICT",
      "更新が競合したか、権限が変更されました。再読込してください。",
    );
}

/** @brief D1のSQLと原子的な更新をInfrastructureへ閉じ込める。 */
export class D1MusicRepository implements MusicRepository {
  /** @brief Music専用DBを受け取る。 */
  constructor(private readonly db: D1Database) {}
  /** @brief 全作品の保存状態を列挙する。 */
  async games(): Promise<Game[]> {
    return (
      await this.db
        .prepare("SELECT * FROM games ORDER BY updated_at DESC,id")
        .all<GameRow>()
    ).results.map(decodeGame);
  }
  /** @brief 主キーで作品を検索する。 */
  async game(id: string): Promise<Game | null> {
    const row = await this.db
      .prepare("SELECT * FROM games WHERE id=?")
      .bind(id)
      .first<GameRow>();
    return row ? decodeGame(row) : null;
  }
  /** @brief 作品内の曲を安定した順で返す。 */
  async tracks(gameId: string): Promise<Track[]> {
    return (
      await this.db
        .prepare("SELECT * FROM tracks WHERE game_id=? ORDER BY position,id")
        .bind(gameId)
        .all<TrackRow>()
    ).results.map(decodeTrack);
  }
  /** @brief 主キーで曲を検索する。 */
  async track(id: string): Promise<Track | null> {
    const row = await this.db
      .prepare("SELECT * FROM tracks WHERE id=?")
      .bind(id)
      .first<TrackRow>();
    return row ? decodeTrack(row) : null;
  }
  /** @brief バージョンと現在権限を条件に作品を更新する。 */
  async saveGame(
    value: Game,
    expected: number,
    actor: Principal,
    action: string,
  ): Promise<void> {
    const adminOnly = action === "game.suspend";
    const args: (string | number | null)[] = [
      JSON.stringify(value.draft),
      value.published ? JSON.stringify(value.published) : null,
      Number(value.suspended),
      actor.id,
      action,
      Date.now(),
      value.id,
      expected,
      actor.id,
    ];
    if (!adminOnly) args.push(value.id);
    changed(
      await this.db
        .prepare(
          `UPDATE games SET draft=?,published=?,suspended=?,version=version+1,actor=?,action=?,updated_at=? WHERE id=? AND version=? AND ${adminOnly ? ADMIN : EDIT}`,
        )
        .bind(...args)
        .run(),
    );
  }
  /** @brief 曲順も公開時に切り替え、下書き編集中の公開順を保つ。 */
  async saveTrack(
    value: Track,
    expected: number,
    actor: Principal,
    action: string,
  ): Promise<void> {
    const position =
      action === "track.publish" ? value.position : value.publishedPosition;
    changed(
      await this.db
        .prepare(
          `UPDATE tracks SET draft=?,published=?,position=?,published_position=?,version=version+1,actor=?,action=?,updated_at=? WHERE id=? AND version=? AND ${EDIT}`,
        )
        .bind(
          JSON.stringify(value.draft),
          value.published ? JSON.stringify(value.published) : null,
          value.position,
          position,
          actor.id,
          action,
          Date.now(),
          value.id,
          expected,
          actor.id,
          value.gameId,
        )
        .run(),
    );
  }
  /** @brief 作成時にも運営ロールを検査する。 */
  async createGame(value: Game, actor: Principal): Promise<void> {
    changed(
      await this.db
        .prepare(
          `INSERT INTO games(id,draft,actor,action,updated_at) SELECT ?,?,?,?,? WHERE ${ADMIN}`,
        )
        .bind(
          value.id,
          JSON.stringify(value.draft),
          actor.id,
          "game.create",
          Date.now(),
          actor.id,
        )
        .run(),
    );
  }
  /** @brief 認可済み作品へ下書きを作成する。 */
  async createTrack(value: Track, actor: Principal): Promise<void> {
    changed(
      await this.db
        .prepare(
          `INSERT INTO tracks(id,game_id,position,draft,actor,action,updated_at) SELECT ?,?,?,?,?,?,? WHERE ${EDIT}`,
        )
        .bind(
          value.id,
          value.gameId,
          value.position,
          JSON.stringify(value.draft),
          actor.id,
          "track.create",
          Date.now(),
          actor.id,
          value.gameId,
        )
        .run(),
    );
  }
  /** @brief 内部メタデータを取得する。 */
  async asset(id: string): Promise<Asset | null> {
    const row = await this.db
      .prepare("SELECT * FROM assets WHERE id=?")
      .bind(id)
      .first<AssetRow>();
    return row
      ? {
          id: row.id,
          gameId: row.game_id,
          key: row.object_key,
          kind: row.kind,
          mime: row.mime,
          bytes: row.bytes,
          status: row.status,
          durationSeconds: row.duration_seconds,
          sampleRateHz: row.sample_rate_hz,
          channels: row.channels,
          widthPixels: row.width_pixels,
          heightPixels: row.height_pixels,
          createdAt: row.created_at,
        }
      : null;
  }
  /** @brief 本文保存前に回収用pending行を残す。 */
  async addAsset(value: Asset, actor: Principal): Promise<void> {
    changed(
      await this.db
        .prepare(
          `INSERT INTO assets(id,game_id,object_key,kind,mime,bytes,status,created_at) SELECT ?,?,?,?,'',?,'pending',? WHERE ${EDIT}`,
        )
        .bind(
          value.id,
          value.gameId,
          value.key,
          value.kind,
          value.bytes,
          value.createdAt,
          actor.id,
          value.gameId,
        )
        .run(),
    );
  }
  /** @brief 検証済みへの一方向遷移に限定し、本文の後付け変更を許さない。 */
  async finishAsset(value: Asset, actor: Principal): Promise<void> {
    const statement = this.db
      .prepare(
        `UPDATE assets SET status='verified',mime=?,duration_seconds=?,sample_rate_hz=?,channels=?,width_pixels=?,height_pixels=? WHERE id=? AND status='pending' AND ${EDIT}`,
      )
      .bind(
        value.mime,
        value.durationSeconds,
        value.sampleRateHz,
        value.channels,
        value.widthPixels,
        value.heightPixels,
        value.id,
        actor.id,
        value.gameId,
      );
    const results = await this.db.batch([
      statement,
      this.db
        .prepare(
          "INSERT INTO audit_log(actor,action,target,at) SELECT ?,'asset.verified',?,? WHERE changes()=1",
        )
        .bind(actor.id, value.id, Date.now()),
    ]);
    changed(results[0]);
  }
  /** @brief 過去IDも現在有効な公開参照がある場合だけ配信する。 */
  async canReadAsset(id: string): Promise<boolean> {
    const row = await this.db
      .prepare(
        `SELECT 1 AS allowed WHERE EXISTS(SELECT 1 FROM games g WHERE g.suspended=0 AND g.published IS NOT NULL AND (json_extract(g.published,'$.imageAssetId')=? OR EXISTS(SELECT 1 FROM tracks t WHERE t.game_id=g.id AND t.published IS NOT NULL AND (json_extract(t.published,'$.audioAssetId')=? OR json_extract(t.published,'$.imageAssetId')=?)))) OR EXISTS(SELECT 1 FROM advertisement WHERE enabled=1 AND image_asset_id=?)`,
      )
      .bind(id, id, id, id)
      .first();
    return row !== null;
  }
  /** @brief 初期OFFの単一広告設定を取得する。 */
  async advertisement(): Promise<Advertisement> {
    const row = await this.db
      .prepare("SELECT * FROM advertisement WHERE id=1")
      .first<{
        enabled: number;
        image_asset_id: string | null;
        href: string;
        alt: string;
        version: number;
      }>();
    return {
      enabled: row!.enabled === 1,
      imageAssetId: row!.image_asset_id,
      href: row!.href,
      alt: row!.alt,
      version: row!.version,
    };
  }
  /** @brief 運営権限とバージョンを同時に検査する。 */
  async saveAdvertisement(
    value: Advertisement,
    actor: Principal,
  ): Promise<void> {
    const results = await this.db.batch([
      this.db
        .prepare(
          `UPDATE advertisement SET enabled=?,image_asset_id=?,href=?,alt=?,version=version+1 WHERE id=1 AND version=? AND ${ADMIN}`,
        )
        .bind(
          Number(value.enabled),
          value.imageAssetId,
          value.href,
          value.alt,
          value.version,
          actor.id,
        ),
      this.db
        .prepare(
          "INSERT INTO audit_log(actor,action,target,at) SELECT ?,'ad.save','site',? WHERE changes()=1",
        )
        .bind(actor.id, Date.now()),
    ]);
    changed(results[0]);
  }
  /** @brief 運営向けのアカウント一覧を取得する。 */
  async accounts(): Promise<Account[]> {
    return (
      await this.db
        .prepare("SELECT * FROM accounts ORDER BY login")
        .all<{ id: string; login: string; admin: number }>()
    ).results.map(
      /** @brief DBのbooleanを変換する。 */ (row) => ({
        ...row,
        admin: row.admin === 1,
      }),
    );
  }
  /** @brief 表示名ではなく安定IDで割り当てを取得する。 */
  async memberships(gameId: string): Promise<string[]> {
    return (
      await this.db
        .prepare("SELECT account_id FROM memberships WHERE game_id=?")
        .bind(gameId)
        .all<{ account_id: string }>()
    ).results.map(/** @brief 担当IDを抽出する。 */ (row) => row.account_id);
  }
  /** @brief 次のAPIから所属変更を反映させる。 */
  async setMembership(
    gameId: string,
    accountId: string,
    enabled: boolean,
    actor: Principal,
  ): Promise<void> {
    const statement = enabled
      ? this.db
          .prepare(
            `INSERT INTO memberships(game_id,account_id) SELECT ?,? WHERE ${ADMIN} ON CONFLICT DO NOTHING`,
          )
          .bind(gameId, accountId, actor.id)
      : this.db
          .prepare(
            `DELETE FROM memberships WHERE game_id=? AND account_id=? AND ${ADMIN}`,
          )
          .bind(gameId, accountId, actor.id);
    await this.db.batch([
      statement,
      this.db
        .prepare(
          "INSERT INTO audit_log(actor,action,target,at) SELECT ?,?,?,? WHERE changes()=1",
        )
        .bind(
          actor.id,
          enabled ? "membership.add" : "membership.remove",
          `${gameId}:${accountId}`,
          Date.now(),
        ),
    ]);
  }
  /** @brief 自身を締め出さず他の運営担当者のロールを変更する。 */
  async setAdmin(
    accountId: string,
    enabled: boolean,
    actor: Principal,
  ): Promise<void> {
    if (accountId === actor.id)
      throw new MusicError(
        "INVALID",
        "自分の運営権限は別の運営担当者から変更してください。",
      );
    const results = await this.db.batch([
      this.db
        .prepare(`UPDATE accounts SET admin=? WHERE id=? AND ${ADMIN}`)
        .bind(Number(enabled), accountId, actor.id),
      this.db
        .prepare(
          "INSERT INTO audit_log(actor,action,target,at) SELECT ?,'account.role',?,? WHERE changes()=1",
        )
        .bind(actor.id, accountId, Date.now()),
    ]);
    changed(results[0]);
  }
  /** @brief 最近100件の操作履歴を返す。 */
  async audit(): Promise<AuditEntry[]> {
    return (
      await this.db
        .prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT 100")
        .all<AuditEntry>()
    ).results;
  }
}
