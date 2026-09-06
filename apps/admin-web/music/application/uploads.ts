import type {
  Asset,
  Principal,
  DomainPolicy,
} from "../../../music/src/domain/models";
import { MusicError } from "../../../music/src/domain/models";
import { authorize, requireValue } from "../../../music/src/domain/rules";

export interface Upload {
  id: string;
  asset: Asset;
  digest: string;
  mime: string;
}
export interface UploadRepository {
  begin(
    gameId: string,
    kind: Asset["kind"],
    bytes: number,
    digest: string,
    mime: string,
    actor: Principal,
  ): Promise<Upload>;
  get(id: string): Promise<Upload | null>;
  finish(upload: Upload, asset: Asset, actor: Principal): Promise<void>;
}
export interface MusicAssetStorage {
  upload(
    upload: Upload,
    body: ReadableStream<Uint8Array>,
    actor: Principal,
  ): Promise<Asset>;
  preview(asset: Asset, actor: Principal): Promise<Response>;
}
/** @brief 認可後にupload ID・digestを固定し、同じ操作だけを再試行させる。 */
export class Uploads {
  /** @brief 保存・転送・投稿制約を注入する。 @param repository upload記録。 @param storage PHPストリーム転送。 @param policy 共通制約。 */
  constructor(
    private repository: UploadRepository,
    private storage: MusicAssetStorage,
    private policy: DomainPolicy,
  ) {}
  /** @brief メタデータだけ先に固定しraw uploadを認可する。 @param gameId 対象作品。 @param kind 素材用途。 @param bytes 実ファイル予定量。 @param digest SHA256。 @param mime 予定形式。 @param actor 現在担当者。 @returns 再試行用ID。 */
  async begin(
    gameId: string,
    kind: Asset["kind"],
    bytes: number,
    digest: string,
    mime: string,
    actor: Principal,
  ): Promise<Upload> {
    authorize(actor, gameId);
    const limit =
      kind === "audio"
        ? this.policy.media.maxAudioFileBytes
        : this.policy.media.maxImageFileBytes;
    if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > limit)
      throw new MusicError("TOO_LARGE", "投稿容量を確認してください。");
    requireValue(
      /^[a-f0-9]{64}$/.test(digest) &&
        (kind === "audio"
          ? ["audio/mpeg", "audio/wav"]
          : ["image/jpeg", "image/png", "image/webp"]
        ).includes(mime),
      "MP3 / PCM WAV / JPEG / PNG / WebPのファイルを指定してください。",
    );
    return this.repository.begin(gameId, kind, bytes, digest, mime, actor);
  }
  /** @brief 解除済み担当者や別作品のupload IDの利用を拒否する。 @param id 固定upload ID。 @param body raw stream。 @param actor 現在担当者。 @returns PHP検証後の素材。 */
  async transfer(
    id: string,
    body: ReadableStream<Uint8Array>,
    actor: Principal,
  ): Promise<Asset> {
    const upload = await this.repository.get(id);
    if (!upload)
      throw new MusicError("NOT_FOUND", "アップロードがありません。");
    authorize(actor, upload.asset.gameId);
    const asset = await this.storage.upload(upload, body, actor);
    await this.repository.finish(upload, asset, actor);
    return asset;
  }
}
