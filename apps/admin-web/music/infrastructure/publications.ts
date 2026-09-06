import type { Principal } from "../../../music/src/domain/models";
import { MusicError } from "../../../music/src/domain/models";
import type {
  PublicationPayload,
  PublicationState,
  Receipt,
} from "../../../../contracts/music/bridge-v1";
import type {
  PublicationMutation,
  PublicationOperation,
  PublicationRepository,
  PublicationTransport,
} from "../application/publications";
import { RentalBridge, digest } from "./bridge";

/** @brief D1側の操作記録と反映済み版を保存するAdapter。 */
export class D1Publications implements PublicationRepository {
  /** @brief 既存control-planeのDBを受け取る。 @param db 共通D1 binding。 */
  constructor(private db: D1Database) {}
  /** @brief 楽観ロック・現在権限・単一保留処理を原子的に確認する。 @param value 公開DTO。 @param mutation 確認後に反映する変更。 @param version 対象の期待版。 @param actor 現在担当者。 @returns 不変操作。 */
  async prepare(
    value: PublicationPayload,
    mutation: PublicationMutation,
    version: number,
    actor: Principal,
  ): Promise<PublicationOperation> {
    const payload = JSON.stringify(value);
    const hash = await digest(payload);
    const id = crypto.randomUUID();
    const scope = value.scope;
    const adminOnly =
      mutation.kind === "ad" ||
      (mutation.kind === "game" && mutation.adminOnly);
    // 作品停止の運営チェックはUse Caseで行い、ここでも一般的な現在所属を必須にする。
    const permission = adminOnly
      ? "a.admin=1"
      : "(a.admin=1 OR EXISTS(SELECT 1 FROM music_memberships WHERE account_id=a.id AND game_id=?))";
    const args: (number | string)[] = [
      id,
      scope,
      scope,
      payload,
      hash,
      JSON.stringify(mutation),
      actor.id,
      Date.now(),
      actor.id,
    ];
    if (!adminOnly) args.push(scope);
    let condition: string;
    if (mutation.kind === "ad") {
      condition = "(SELECT version FROM music_advertisement WHERE id=1)=?";
      args.push(version);
    } else if (mutation.kind === "game") {
      condition = "(SELECT version FROM music_games WHERE id=?)=?";
      args.push(scope, version);
    } else {
      condition =
        "(SELECT version FROM music_tracks WHERE id=? AND game_id=?)=? AND (SELECT version FROM music_games WHERE id=?)=?";
      args.push(mutation.value.id, scope, version, scope, mutation.gameVersion);
    }
    let result: D1Result;
    try {
      result = await this.db
        .prepare(
          `INSERT INTO music_publications(id,scope,state,expected_revision,payload,digest,mutation,actor,created_at) SELECT ?,?,'prepared',COALESCE((SELECT revision FROM music_delivery WHERE scope=?),0),?,?,?,?,? WHERE EXISTS(SELECT 1 FROM music_accounts a WHERE a.id=? AND ${permission}) AND ${condition}`,
        )
        .bind(...args)
        .run();
    } catch {
      throw new MusicError(
        "CONFLICT",
        "未確定の公開処理があります。先に状態確認・再試行してください。",
      );
    }
    if (result.meta.changes !== 1)
      throw new MusicError(
        "CONFLICT",
        "下書きまたは権限が変更されました。再読込してください。",
      );
    return (await this.operation(id))!;
  }
  /** @brief 操作IDを解決する。 @param id UUID。 @returns 操作またはnull。 */
  async operation(id: string): Promise<PublicationOperation | null> {
    return this.db
      .prepare("SELECT * FROM music_publications WHERE id=?")
      .bind(id)
      .first<PublicationOperation>();
  }
  /** @brief 現在の担当範囲だけに公開状態を返す。 @param actor 現在担当者。 @returns 操作一覧。 */
  async list(actor: Principal): Promise<PublicationOperation[]> {
    return (
      await this.db
        .prepare(
          `SELECT * FROM music_publications p WHERE EXISTS(SELECT 1 FROM music_accounts a WHERE a.id=? AND (a.admin=1 OR EXISTS(SELECT 1 FROM music_memberships m WHERE m.account_id=a.id AND m.game_id=p.scope))) ORDER BY created_at DESC LIMIT 100`,
        )
        .bind(actor.id)
        .all<PublicationOperation>()
    ).results;
  }
  /** @brief 確定結果を後からsendingへ戻さない。 @param id 操作ID。 @param state 処理状態。 @param error 安全な説明。 @returns 保存完了。 */
  async state(
    id: string,
    state: PublicationState,
    error?: string,
  ): Promise<void> {
    await this.db
      .prepare(
        "UPDATE music_publications SET state=?,error=? WHERE id=? AND state!='applied'",
      )
      .bind(state, error ?? null, id)
      .run();
  }
  /** @brief 下書きを書き戻さず公開列と確認版だけをD1 batchで確定する。 @param operation 元操作。 @param receipt PHPで確認済み結果。 @returns 保存完了。 */
  async confirm(
    operation: PublicationOperation,
    receipt: Receipt,
  ): Promise<void> {
    const mutation = JSON.parse(operation.mutation) as PublicationMutation;
    const pending =
      "EXISTS(SELECT 1 FROM music_publications WHERE id=? AND state!='applied')";
    const statements: D1PreparedStatement[] = [];
    if (mutation.kind === "game")
      statements.push(
        this.db
          .prepare(
            `UPDATE music_games SET published=?,suspended=?,version=version+1,actor=?,action='publication.confirm',updated_at=? WHERE id=? AND ${pending}`,
          )
          .bind(
            mutation.value.published
              ? JSON.stringify(mutation.value.published)
              : null,
            Number(mutation.value.suspended),
            operation.actor,
            Date.now(),
            operation.scope,
            operation.id,
          ),
      );
    else if (mutation.kind === "track")
      statements.push(
        this.db
          .prepare(
            `UPDATE music_tracks SET published=?,published_position=?,version=version+1,actor=?,action='publication.confirm',updated_at=? WHERE id=? AND game_id=? AND ${pending}`,
          )
          .bind(
            mutation.value.published
              ? JSON.stringify(mutation.value.published)
              : null,
            mutation.value.publishedPosition,
            operation.actor,
            Date.now(),
            mutation.value.id,
            operation.scope,
            operation.id,
          ),
      );
    else
      statements.push(
        this.db
          .prepare(
            `UPDATE music_advertisement SET enabled=?,image_asset_id=?,href=?,alt=?,version=version+1 WHERE id=1 AND ${pending}`,
          )
          .bind(
            Number(mutation.value.enabled),
            mutation.value.imageAssetId,
            mutation.value.href,
            mutation.value.alt,
            operation.id,
          ),
      );
    statements.push(
      this.db
        .prepare(
          "INSERT INTO music_delivery(scope,revision) VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET revision=MAX(revision,excluded.revision)",
        )
        .bind(operation.scope, receipt.revision),
    );
    statements.push(
      this.db
        .prepare(
          "INSERT INTO music_audit_log(actor,action,target,at) SELECT ?,'publication.confirm',?,? WHERE EXISTS(SELECT 1 FROM music_publications WHERE id=? AND state!='applied')",
        )
        .bind(operation.actor, operation.id, Date.now(), operation.id),
    );
    statements.push(
      this.db
        .prepare(
          "UPDATE music_publications SET state='applied',receipt=?,error=NULL WHERE id=?",
        )
        .bind(JSON.stringify(receipt), operation.id),
    );
    await this.db.batch(statements);
  }
}

/** @brief 公開Use CaseのPortを固定PHP署名要求に適合させる。 */
export class RentalPublisher implements PublicationTransport {
  /** @brief 署名済み転送を注入する。 @param bridge 固定PHP接続。 */
  constructor(private bridge: RentalBridge) {}
  /** @brief 不変本文を反映する。 @param operation 固定要求。 @param actor 現在の操作者。 @returns 照合済みreceipt。 */
  async apply(
    operation: PublicationOperation,
    actor: Principal,
  ): Promise<Receipt> {
    const response = await this.bridge.request(
      {
        action: "publish",
        operationId: operation.id,
        gameId: operation.scope,
        actorId: actor.id,
        payloadDigest: operation.digest,
        expectedRevision: operation.expected_revision,
      },
      operation.payload,
    );
    return this.bridge.verifyReceipt(
      await this.bridge.json<Receipt>(response),
      operation,
    );
  }
  /** @brief 同じdigest・版・scopeで結果を照会する。 @param operation 固定要求。 @param actor 現在の操作者。 @returns 未反映ならnull。 */
  async status(
    operation: PublicationOperation,
    actor: Principal,
  ): Promise<Receipt | null> {
    const response = await this.bridge.request({
      action: "status",
      operationId: operation.id,
      gameId: operation.scope,
      actorId: actor.id,
      payloadDigest: operation.digest,
      expectedRevision: operation.expected_revision,
    });
    const { receipt } = await this.bridge.json<{ receipt: Receipt | null }>(
      response,
    );
    return receipt ? this.bridge.verifyReceipt(receipt, operation) : null;
  }
}
