import {
  MusicError,
  type Advertisement,
  type Asset,
  type DomainPolicy,
  type Game,
  type Principal,
  type PublicGame,
  type PublicTrack,
  type Track,
} from "../domain/models";
import {
  authorize,
  createLoopRegion,
  gameContent,
  requireValue,
  safeUrl,
  textValue,
  trackContent,
  validateAsset,
  validatePolicy,
} from "../domain/rules";
import type { AssetStorage, Clock, IdSource, MusicRepository } from "./ports";

/** @brief 作品編集・公開・素材の認可をHTTPから独立して実行する。 */
export class MusicService {
  /** @brief 外側から永続化・保存・時刻・ID・ルールを注入する。 */
  constructor(
    readonly repository: MusicRepository,
    readonly storage: AssetStorage,
    readonly policy: DomainPolicy,
    readonly clock: Clock,
    readonly ids: IdSource,
    readonly audioLimits: {
      decodedAudioBudgetBytes: number;
      decodeSampleRateHz: number;
    },
  ) {
    validatePolicy(policy);
  }
  /** @brief 非公開の情報を混ぜず公開カタログを構築する。 @returns 公開作品と公開曲。 */
  async catalogue(): Promise<PublicGame[]> {
    const result: PublicGame[] = [];
    for (const game of await this.repository.games()) {
      if (!game.published || game.suspended) continue;
      const tracks: PublicTrack[] = [];
      for (const track of await this.repository.tracks(game.id))
        if (track.published) tracks.push(await this.publicTrack(track, false));
      tracks.sort(
        /** @brief 公開時の曲順を維持する。 */ (left, right) =>
          left.position - right.position || left.id.localeCompare(right.id),
      );
      result.push({ id: game.id, ...game.published, tracks });
    }
    return result;
  }
  /** @brief 再生に必要な検証済みメタデータだけをDTOへ加える。 @param track 保存行。 @param preview 下書き版を使用するか。 @returns プレーヤー用DTO。 */
  async publicTrack(track: Track, preview: boolean): Promise<PublicTrack> {
    const content = preview ? track.draft : track.published;
    requireValue(
      content?.audioAssetId,
      "音源を登録してください。",
      "audioAssetId",
    );
    const audio = await this.repository.asset(content.audioAssetId);
    validateAsset(audio, track.gameId, "audio");
    return {
      ...content,
      id: track.id,
      gameId: track.gameId,
      position: preview
        ? track.position
        : (track.publishedPosition ?? track.position),
      durationSeconds: audio.durationSeconds!,
      sampleRateHz: audio.sampleRateHz!,
      channels: audio.channels!,
      audioBytes: audio.bytes,
    };
  }
  /** @brief 担当作品だけを管理画面に返す。 @param actor 現在の権限。 */
  async managedGames(actor: Principal | null): Promise<Game[]> {
    if (!actor)
      throw new MusicError("UNAUTHENTICATED", "ログインしてください。");
    return (await this.repository.games()).filter(
      /** @brief 未担当作品を管理一覧から除く。 */ (game) =>
        actor.admin || actor.gameIds.includes(game.id),
    );
  }
  /** @brief 作品取得と認可を統一する。 @param id 作品ID。 @param actor 現在の権限。 */
  async managedGame(id: string, actor: Principal | null): Promise<Game> {
    authorize(actor, id);
    const game = await this.repository.game(id);
    if (!game) throw new MusicError("NOT_FOUND", "作品が見つかりません。");
    return game;
  }
  /** @brief 曲IDから所属作品を解決して認可する。 @param id 曲ID。 @param actor 現在の権限。 */
  async managedTrack(id: string, actor: Principal | null): Promise<Track> {
    const track = await this.repository.track(id);
    if (!track) throw new MusicError("NOT_FOUND", "曲が見つかりません。");
    authorize(actor, track.gameId);
    return track;
  }
  /** @brief 運営だけが空の作品を作成できる。 @param input 作品内容。 @param actor 操作者。 */
  async createGame(input: unknown, actor: Principal | null): Promise<Game> {
    authorize(actor);
    const draft = gameContent(input, this.policy);
    requireValue(!draft.imageAssetId, "作品作成後に画像を登録してください。");
    const game: Game = {
      id: this.ids.next(),
      version: 1,
      draft,
      published: null,
      suspended: false,
    };
    await this.repository.createGame(game, actor);
    return game;
  }
  /** @brief 必要な画像の所属・検証状態を保存時から確認する。 @param id 素材ID。 @param gameId 作品。 */
  async checkImage(id: string | null, gameId: string): Promise<void> {
    if (id) validateAsset(await this.repository.asset(id), gameId, "image");
  }
  /** @brief 楽観ロックで作品下書きだけを変更する。 */
  async editGame(
    id: string,
    input: unknown,
    version: number,
    actor: Principal | null,
  ): Promise<void> {
    const game = await this.managedGame(id, actor);
    const draft = gameContent(input, this.policy);
    await this.checkImage(draft.imageAssetId, id);
    await this.repository.saveGame(
      { ...game, draft },
      version,
      actor!,
      "game.save",
    );
  }
  /** @brief 承認待ちを挟まず作品の公開版を切り替える。 */
  async publishGame(
    id: string,
    publish: boolean,
    version: number,
    actor: Principal | null,
  ): Promise<void> {
    const game = await this.managedGame(id, actor);
    if (publish) {
      requireValue(!game.suspended, "運営による公開停止中です。");
      requireValue(
        game.draft.rightsConfirmed,
        "権利確認にチェックしてください。",
        "rightsConfirmed",
      );
      await this.checkImage(game.draft.imageAssetId, id);
      requireValue(
        !game.draft.imageAssetId || game.draft.imageAlt,
        "画像の代替テキストを入力してください。",
        "imageAlt",
      );
    }
    await this.repository.saveGame(
      { ...game, published: publish ? game.draft : null },
      version,
      actor!,
      publish ? "game.publish" : "game.unpublish",
    );
  }
  /** @brief 運営の緊急停止を担当者の公開操作から独立させる。 */
  async suspendGame(
    id: string,
    suspended: boolean,
    version: number,
    actor: Principal | null,
  ): Promise<void> {
    authorize(actor);
    const game = await this.managedGame(id, actor);
    await this.repository.saveGame(
      { ...game, suspended },
      version,
      actor,
      "game.suspend",
    );
  }
  /** @brief 担当作品に空の下書き曲を追加する。 */
  async createTrack(
    gameId: string,
    title: string,
    actor: Principal | null,
  ): Promise<Track> {
    await this.managedGame(gameId, actor);
    const tracks = await this.repository.tracks(gameId);
    const track: Track = {
      id: this.ids.next(),
      gameId,
      version: 1,
      publishedPosition: null,
      position:
        tracks.reduce(
          /** @brief 空き曲順を末尾に確保する。 */ (max, item) =>
            Math.max(max, item.position),
          0,
        ) + 1,
      draft: {
        title: textValue(title, this.policy.text.titleMax, "title", true),
        credits: [],
        comment: "",
        audioAssetId: null,
        imageAssetId: null,
        imageAlt: "",
        loop: null,
        rightsConfirmed: false,
      },
      published: null,
    };
    await this.repository.createTrack(track, actor!);
    return track;
  }
  /** @brief 素材とループの関係を公開前も検証する。 */
  async checkTrack(track: Track, publishing: boolean): Promise<void> {
    const content = track.draft;
    await this.checkImage(content.imageAssetId, track.gameId);
    if (content.audioAssetId) {
      const audio = await this.repository.asset(content.audioAssetId);
      validateAsset(audio, track.gameId, "audio");
      if (content.loop)
        createLoopRegion(
          content.loop.startSeconds,
          content.loop.endSeconds,
          audio.durationSeconds!,
          this.policy.loop.minimumLengthSeconds,
        );
    } else
      requireValue(
        !content.loop && !publishing,
        "音源を登録してください。",
        "audioAssetId",
      );
    if (publishing) {
      if (content.loop && content.audioAssetId) {
        const audio = await this.repository.asset(content.audioAssetId);
        requireValue(
          audio!.durationSeconds! *
            this.audioLimits.decodeSampleRateHz *
            audio!.channels! *
            4 <=
            this.audioLimits.decodedAudioBudgetBytes,
          "区間ループのメモリ予算を超えます。通常再生のみを選ぶか、音源を差し替えてください。",
          "loop",
        );
      }
      requireValue(
        content.rightsConfirmed,
        "音源・画像・クレジットと広告付きサイトでの利用を確認してください。",
        "rightsConfirmed",
      );
      requireValue(
        content.credits.length > 0,
        "クレジットを登録してください。",
        "credits",
      );
      requireValue(
        !content.imageAssetId || content.imageAlt,
        "画像の代替テキストを入力してください。",
        "imageAlt",
      );
    }
  }
  /** @brief 音源変更時の古いループ流用を禁止し下書き保存する。 */
  async editTrack(
    id: string,
    input: unknown,
    position: number,
    version: number,
    actor: Principal | null,
  ): Promise<void> {
    const track = await this.managedTrack(id, actor);
    const draft = trackContent(input, this.policy);
    requireValue(
      Number.isSafeInteger(position) && position >= 1,
      "曲順は1以上の整数にしてください。",
      "position",
    );
    requireValue(
      track.draft.audioAssetId === draft.audioAssetId || !draft.loop,
      "音源差し替え時は一度ループを解除して保存し、改めて設定・試聴してください。",
      "loop",
    );
    await this.checkTrack({ ...track, draft }, false);
    await this.repository.saveTrack(
      { ...track, draft, position },
      version,
      actor!,
      "track.save",
    );
  }
  /** @brief 音源・画像・ループを1回のDB更新で公開版に反映する。 */
  async publishTrack(
    id: string,
    publish: boolean,
    version: number,
    actor: Principal | null,
  ): Promise<void> {
    const track = await this.managedTrack(id, actor);
    if (publish) {
      const game = await this.managedGame(track.gameId, actor);
      requireValue(!game.suspended, "運営による公開停止中です。");
      await this.checkTrack(track, true);
    }
    await this.repository.saveTrack(
      { ...track, published: publish ? track.draft : null },
      version,
      actor!,
      publish ? "track.publish" : "track.unpublish",
    );
  }
  /** @brief 認可後のストリームを非公開領域へ保存し、検証完了後だけ確定する。 */
  async upload(
    gameId: string,
    kind: Asset["kind"],
    bytes: number,
    body: ReadableStream<Uint8Array>,
    actor: Principal | null,
  ): Promise<Asset> {
    await this.managedGame(gameId, actor);
    const max =
      kind === "audio"
        ? this.policy.media.maxAudioFileBytes
        : this.policy.media.maxImageFileBytes;
    if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > max)
      throw new MusicError(
        "TOO_LARGE",
        `容量は1〜${max} bytesで指定してください。`,
      );
    const asset: Asset = {
      id: this.ids.next(),
      key: this.ids.next(),
      gameId,
      kind,
      bytes,
      mime: "",
      status: "pending",
      durationSeconds: null,
      sampleRateHz: null,
      channels: null,
      widthPixels: null,
      heightPixels: null,
      createdAt: this.clock.now(),
    };
    await this.repository.addAsset(asset, actor!);
    try {
      // 同一キーへの再アップロードAPIを設けず、検証した本文を不変にする。
      await this.storage.put(asset.key, body, bytes);
      const metadata = await this.storage.inspect(asset.key, kind, bytes);
      if (kind === "audio")
        requireValue(
          metadata.durationSeconds &&
            metadata.durationSeconds > 0 &&
            metadata.durationSeconds <=
              this.policy.media.maxAudioDurationSeconds &&
            metadata.sampleRateHz &&
            metadata.channels,
          "音源長・サンプルレート・チャンネル数を確認してください。",
        );
      else
        requireValue(
          metadata.widthPixels &&
            metadata.heightPixels &&
            Math.max(metadata.widthPixels, metadata.heightPixels) <=
              this.policy.media.maxImageEdgePixels,
          "画像の辺が上限を超えているか、画像が不正です。",
        );
      Object.assign(asset, metadata, { status: "verified" });
      await this.repository.finishAsset(asset, actor!);
      return asset;
    } catch (error) {
      // R2とDBは別トランザクション。公開参照を作らず、回収可能なpending行を残す。
      await this.storage
        .remove(asset.key)
        .catch(
          /** @brief 回収失敗は後の孤立素材整理に任せ、元の失敗を保持する。 */ () =>
            undefined,
        );
      if (error instanceof MusicError) throw error;
      throw new MusicError(
        "INVALID",
        "素材を検証できませんでした。対応形式を確認して再試行してください。",
      );
    }
  }
  /** @brief 公開参照または現在の作品権限を確認して素材を返す。 */
  async readableAsset(id: string, actor: Principal | null): Promise<Asset> {
    const asset = await this.repository.asset(id);
    if (!asset || asset.status !== "verified")
      throw new MusicError("NOT_FOUND", "素材が見つかりません。");
    if (!(await this.repository.canReadAsset(id))) {
      if (!actor || (!actor.admin && !actor.gameIds.includes(asset.gameId)))
        throw new MusicError("NOT_FOUND", "素材が見つかりません。");
    }
    return asset;
  }
  /** @brief 任意HTMLを許さず運営バナーだけを保存する。 */
  async saveAdvertisement(
    input: Advertisement,
    actor: Principal | null,
  ): Promise<void> {
    authorize(actor);
    const value = {
      enabled: input.enabled === true,
      imageAssetId: input.imageAssetId,
      href: safeUrl(input.href, this.policy.text.urlMax),
      alt: textValue(input.alt, this.policy.text.imageAltMax, "alt"),
      version: input.version,
    };
    if (value.imageAssetId) {
      const asset = await this.repository.asset(value.imageAssetId);
      requireValue(
        asset?.status === "verified" && asset.kind === "image",
        "検証済み画像を選んでください。",
      );
    }
    requireValue(
      !value.enabled || (value.imageAssetId && value.href && value.alt),
      "広告画像・リンク・代替テキストを指定してください。",
    );
    await this.repository.saveAdvertisement(value, actor);
  }
  /** @brief 運営専用の設定・履歴を取得する。 */
  async adminSettings(actor: Principal | null) {
    authorize(actor);
    const [advertisement, accounts, audit] = await Promise.all([
      this.repository.advertisement(),
      this.repository.accounts(),
      this.repository.audit(),
    ]);
    return { advertisement, accounts, audit };
  }
  /** @brief ログイン済みの安定IDを作品へ割り当て・解除する。 */
  async changeMembership(
    gameId: string,
    accountId: string,
    enabled: boolean,
    actor: Principal | null,
  ): Promise<void> {
    authorize(actor);
    await this.managedGame(gameId, actor);
    requireValue(
      (await this.repository.accounts()).some(
        /** @brief 表示名による権限付与を禁止する。 */ (account) =>
          account.id === accountId,
      ),
      "先に対象者にログインしてもらってください。",
    );
    await this.repository.setMembership(gameId, accountId, enabled, actor);
  }
  /** @brief 運営のロール変更をユースケースの境界でも検証する。 */
  async changeAdmin(
    accountId: string,
    enabled: boolean,
    actor: Principal | null,
  ): Promise<void> {
    authorize(actor);
    requireValue(
      accountId !== actor.id,
      "自分の運営権限は別の運営担当者から変更してください。",
    );
    await this.repository.setAdmin(accountId, enabled, actor);
  }
}
