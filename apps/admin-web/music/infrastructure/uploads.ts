import type { Asset, Principal } from "../../../music/src/domain/models";
import { MusicError } from "../../../music/src/domain/models";
import type {
  MusicAssetStorage,
  Upload,
  UploadRepository,
} from "../application/uploads";
import { D1MusicRepository } from "./repository";
import { RentalBridge, digest } from "./bridge";

/** @brief upload拘束情報をD1の素材と同時に保存する。 */
export class D1Uploads implements UploadRepository {
  /** @brief 既存素材Repositoryを再利用する。 @param repository 素材保存。 */
  constructor(private repository: D1MusicRepository) {}
  /** @brief 作品認可をSQLで再確認して一意のuploadを作る。 @param gameId 作品。 @param kind 用途。 @param bytes 予定量。 @param hash 予定SHA256。 @param mime 予定MIME。 @param actor 担当者。 @returns 不変のupload。 */
  async begin(
    gameId: string,
    kind: Asset["kind"],
    bytes: number,
    hash: string,
    mime: string,
    actor: Principal,
  ): Promise<Upload> {
    const id = crypto.randomUUID();
    const asset: Asset = {
      id: crypto.randomUUID(),
      gameId,
      key: "",
      kind,
      bytes,
      mime: "",
      status: "pending",
      createdAt: Date.now(),
      durationSeconds: null,
      sampleRateHz: null,
      channels: null,
      widthPixels: null,
      heightPixels: null,
    };
    asset.key = asset.id;
    const db = this.repository.db;
    const result = await db.batch([
      db
        .prepare(
          "INSERT INTO music_assets(id,game_id,object_key,kind,mime,bytes,status,created_at) SELECT ?,?,?,?,'',?,'pending',? WHERE EXISTS(SELECT 1 FROM music_accounts a WHERE a.id=? AND (a.admin=1 OR EXISTS(SELECT 1 FROM music_memberships WHERE account_id=a.id AND game_id=?))) AND EXISTS(SELECT 1 FROM music_games WHERE id=?)",
        )
        .bind(
          asset.id,
          gameId,
          asset.id,
          kind,
          bytes,
          asset.createdAt,
          actor.id,
          gameId,
          gameId,
        ),
      db
        .prepare(
          "INSERT INTO music_uploads(id,asset_id,game_id,digest,mime) SELECT ?,?,?,?,? WHERE changes()=1",
        )
        .bind(id, asset.id, gameId, hash, mime),
    ]);
    if (result[0].meta.changes !== 1)
      throw new MusicError("FORBIDDEN", "作品の編集権限がありません。");
    return { id, asset, digest: hash, mime };
  }
  /** @brief upload IDから所属を解決する。 @param id upload UUID。 @returns uploadまたはnull。 */
  async get(id: string): Promise<Upload | null> {
    const row = await this.repository.db
      .prepare("SELECT * FROM music_uploads WHERE id=?")
      .bind(id)
      .first<{ id: string; asset_id: string; digest: string; mime: string }>();
    const asset = row ? await this.repository.asset(row.asset_id) : null;
    return row && asset
      ? { id, asset, digest: row.digest, mime: row.mime }
      : null;
  }
  /** @brief PHP反映後のD1失敗にも同じuploadで追いつける。 @param upload 元要求。 @param asset 検証済み結果。 @param actor 担当者。 @returns 保存完了。 */
  async finish(upload: Upload, asset: Asset, actor: Principal): Promise<void> {
    if ((await this.repository.asset(asset.id))?.status === "verified") return;
    await this.repository.finishAsset(
      { ...asset, key: upload.asset.key, createdAt: upload.asset.createdAt },
      actor,
    );
  }
}

/** @brief 原本をWorkerでデコードせずPHPへストリーム転送する。 */
export class RentalAssetStorage implements MusicAssetStorage {
  /** @brief 固定bridgeを注入する。 @param bridge PHP署名Client。 */
  constructor(private bridge: RentalBridge) {}
  /** @brief 実容量・digest・形式・所属をPHP検証結果と照合する。 @param upload 固定情報。 @param body raw音源。 @param actor 現在担当者。 @returns 検証済み素材。 */
  async upload(
    upload: Upload,
    body: ReadableStream<Uint8Array>,
    actor: Principal,
  ): Promise<Asset> {
    const response = await this.bridge.request(
      {
        action: "upload",
        operationId: upload.id,
        gameId: upload.asset.gameId,
        assetId: upload.asset.id,
        actorId: actor.id,
        payloadDigest: upload.digest,
        expectedRevision: 0,
        bytes: upload.asset.bytes,
        kind: upload.asset.kind,
        mime: upload.mime,
      },
      body,
    );
    const result = await this.bridge.json<
      Asset & { digest: string; uploadId: string }
    >(response);
    if (
      result.id !== upload.asset.id ||
      result.gameId !== upload.asset.gameId ||
      result.bytes !== upload.asset.bytes ||
      result.kind !== upload.asset.kind ||
      result.mime !== upload.mime ||
      result.digest !== upload.digest ||
      result.uploadId !== upload.id ||
      result.status !== "verified"
    )
      throw new MusicError(
        "UNAVAILABLE",
        "素材の検証結果が要求と一致しません。",
      );
    return {
      ...result,
      key: upload.asset.key,
      createdAt: upload.asset.createdAt,
    };
  }
  /** @brief 非公開試聴を認証済み管理APIだけにストリームで返す。 @param asset 認可済み素材。 @param actor 担当者。 @returns 非キャッシュ音源・画像。 */
  async preview(asset: Asset, actor: Principal): Promise<Response> {
    const response = await this.bridge.request({
      action: "preview",
      operationId: crypto.randomUUID(),
      gameId: asset.gameId,
      assetId: asset.id,
      actorId: actor.id,
      payloadDigest: await digest(""),
      expectedRevision: 0,
    });
    return new Response(response.body, {
      headers: {
        "Content-Type": asset.mime,
        "Content-Length": String(asset.bytes),
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
}
