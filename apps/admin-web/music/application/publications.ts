import type {
  Advertisement,
  Game,
  Principal,
  PublicGame,
  Track,
} from "../../../music/src/domain/models";
import { MusicError } from "../../../music/src/domain/models";
import { authorize, validateAsset } from "../../../music/src/domain/rules";
import type { MusicRepository } from "../../../music/src/application/ports";
import type {
  PublicationPayload,
  Receipt,
  PublicationState,
} from "../../../../contracts/music/bridge-v1";

export interface PublicationOperation {
  id: string;
  scope: string;
  state: PublicationState;
  payload: string;
  digest: string;
  expected_revision: number;
  mutation: string;
  actor: string;
  error: string | null;
}
export type PublicationMutation =
  | { kind: "game"; value: Game; adminOnly: boolean }
  | { kind: "track"; value: Track; gameVersion: number }
  | { kind: "ad"; value: Advertisement };
export interface PublicationRepository {
  prepare(
    payload: PublicationPayload,
    mutation: PublicationMutation,
    version: number,
    actor: Principal,
  ): Promise<PublicationOperation>;
  operation(id: string): Promise<PublicationOperation | null>;
  list(actor: Principal): Promise<PublicationOperation[]>;
  state(id: string, state: PublicationState, error?: string): Promise<void>;
  confirm(operation: PublicationOperation, receipt: Receipt): Promise<void>;
}
export interface PublicationTransport {
  apply(operation: PublicationOperation, actor: Principal): Promise<Receipt>;
  status(
    operation: PublicationOperation,
    actor: Principal,
  ): Promise<Receipt | null>;
}

/** @brief 不変の要求を先に記録し、外部確認後だけD1を公開済みにする。 */
export class Publications {
  /** @brief 保存・転送Portと既存の素材検証を注入する。 @param repository 操作保存。 @param transport 配信反映。 @param music 既存検証Use Case。 */
  constructor(
    private repository: PublicationRepository,
    private transport: PublicationTransport,
    private music: MusicRepository,
  ) {}
  /** @brief 作品単位の公開DTOへ今回の変更だけを加える。 @param game 公開候補作品。 @param changedTrack 変更候補曲。 @returns 不変に保存するDTO。 */
  private async snapshot(
    game: Game,
    changedTrack?: Track,
  ): Promise<PublicGame | null> {
    if (!game.published || game.suspended) return null;
    const tracks = await this.music.tracks(game.id);
    const result = [];
    for (const original of tracks) {
      const track = original.id === changedTrack?.id ? changedTrack : original;
      if (track.published) {
        const audio = track.published.audioAssetId
          ? await this.music.asset(track.published.audioAssetId)
          : null;
        validateAsset(audio, game.id, "audio");
        result.push({
          ...track.published,
          id: track.id,
          gameId: game.id,
          position: track.publishedPosition ?? track.position,
          durationSeconds: audio.durationSeconds!,
          sampleRateHz: audio.sampleRateHz!,
          channels: audio.channels!,
          audioBytes: audio.bytes,
        });
      }
    }
    result.sort(
      /** @brief 公開曲順だけで並べる。 */ (a, b) =>
        a.position - b.position || a.id.localeCompare(b.id),
    );
    return { id: game.id, ...game.published, tracks: result };
  }
  /** @brief 作品公開・停止の要求を固定する。 @param value 検証済み変更。 @param version 編集開始版。 @param actor 現在担当者。 @returns 反映状態。 */
  async game(
    value: Game,
    version: number,
    actor: Principal,
    adminOnly = false,
  ): Promise<void> {
    const payload: PublicationPayload = {
      protocolVersion: 1,
      scope: value.id,
      game: await this.snapshot(value),
    };
    const operation = await this.repository.prepare(
      payload,
      { kind: "game", value, adminOnly },
      version,
      actor,
    );
    await this.run(operation, actor);
  }
  /** @brief 曲公開時に他曲の公開状態を維持する。 @param value 検証済み曲。 @param version 曲の期待版。 @param actor 現在担当者。 @returns 反映状態。 */
  async track(value: Track, version: number, actor: Principal): Promise<void> {
    authorize(actor, value.gameId);
    const game = await this.music.game(value.gameId);
    if (!game) throw new MusicError("NOT_FOUND", "作品がありません。");
    const track = {
      ...value,
      publishedPosition: value.published
        ? value.position
        : value.publishedPosition,
    };
    const payload: PublicationPayload = {
      protocolVersion: 1,
      scope: game.id,
      game: await this.snapshot(game, track),
    };
    const operation = await this.repository.prepare(
      payload,
      { kind: "track", value: track, gameVersion: game.version },
      version,
      actor,
    );
    await this.run(operation, actor);
  }
  /** @brief 運営専用広告を作品と独立したscopeで反映する。 @param value 検証済みバナー。 @param actor Music運営。 @returns 反映状態。 */
  async advertisement(value: Advertisement, actor: Principal): Promise<void> {
    authorize(actor);
    const operation = await this.repository.prepare(
      { protocolVersion: 1, scope: "ads", game: null, advertisement: value },
      { kind: "ad", value },
      value.version,
      actor,
    );
    await this.run(operation, actor);
  }
  /** @brief 未確定処理は元の内容を使い、照会後だけ再送する。 @param id 操作ID。 @param actor 現在担当者。 @returns 反映状態。 */
  async retry(id: string, actor: Principal): Promise<void> {
    const operation = await this.repository.operation(id);
    if (!operation) throw new MusicError("NOT_FOUND", "公開操作がありません。");
    authorize(actor, operation.scope === "ads" ? undefined : operation.scope);
    const mutation = JSON.parse(operation.mutation) as PublicationMutation;
    if (mutation.kind === "game" && mutation.adminOnly) authorize(actor);
    if (operation.state === "applied") return;
    await this.run(operation, actor);
  }
  /** @brief 外部結果とD1更新の間の障害を結果不明として保持する。 @param operation 固定した要求。 @param actor 現在担当者。 @returns 確認済みの場合だけ成功。 */
  private async run(
    operation: PublicationOperation,
    actor: Principal,
  ): Promise<void> {
    await this.repository.state(operation.id, "sending");
    let receipt: Receipt | null = null;
    try {
      receipt = await this.transport.status(operation, actor);
      receipt ??= await this.transport.apply(operation, actor);
      await this.repository.confirm(operation, receipt);
    } catch (error) {
      const definite =
        !receipt &&
        error instanceof MusicError &&
        ["INVALID", "CONFLICT", "TOO_LARGE"].includes(error.code);
      await this.repository.state(
        operation.id,
        definite ? "failed" : "unknown",
        definite
          ? "配信サーバーが拒否しました。"
          : "反映結果不明・取り下げ未反映の可能性があります。元の操作で再照合してください。",
      );
      throw new MusicError(
        "UNAVAILABLE",
        `公開処理 ${operation.id} は${definite ? "失敗" : "結果不明"}です。状態確認・再試行を実行してください。`,
      );
    }
  }
}
