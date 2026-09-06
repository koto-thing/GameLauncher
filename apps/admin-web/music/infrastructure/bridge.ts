import type { Envelope, Receipt } from "../../../../contracts/music/bridge-v1";
import { MusicError } from "../../../music/src/domain/models";
import { MUSIC_RUNTIME, type MusicSettings } from "../config/settings";

/** @brief UTF-8の本文をSHA-256小文字hexへ変換する。 @param value 署名対象。 @returns 64文字digest。 */
export async function digest(value: string): Promise<string> {
  return Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  ).toString("hex");
}
/** @brief TS/PHP共通の改行付き文字列へ署名する。 @param envelope フィールド拘束情報。 @param secret Music専用鍵。 @returns 転送ヘッダー。 */
export async function signatureHeaders(
  envelope: Envelope,
  secret: string,
): Promise<Record<string, string>> {
  const encoded = Buffer.from(JSON.stringify(envelope), "utf8").toString(
    "base64url",
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = Buffer.from(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`PandD-Music-v1\n${encoded}`),
    ),
  ).toString("hex");
  return { "X-Music-Envelope": encoded, "X-Music-Signature": signature };
}

/** @brief 固定管理bridgeへ用途限定要求を送り、CookieやGitHubトークンを渡さない。 */
export class RentalBridge {
  /** @brief 認可の外側で検証した固定接続先を受け取る。 @param config 接続設定。 */
  constructor(private readonly config: MusicSettings) {}
  /** @brief 毎回新しいnonceで同一論理操作を再送可能にする。 @param input 認可済みの対象。 @param body JSONまたはraw upload stream。 @returns ストリーム応答。 */
  async request(
    input: Pick<
      Envelope,
      | "action"
      | "operationId"
      | "actorId"
      | "gameId"
      | "payloadDigest"
      | "expectedRevision"
    > &
      Partial<Pick<Envelope, "assetId" | "bytes" | "kind" | "mime">>,
    body?: BodyInit,
  ): Promise<Response> {
    const issuedAt = Math.floor(Date.now() / 1000);
    const envelope: Envelope = {
      protocolVersion: 1,
      audience: "pandd-music",
      keyId: this.config.keyId,
      environment: this.config.environment,
      method: "POST",
      path: new URL(this.config.bridgeUrl).pathname,
      issuedAt,
      expiresAt: issuedAt + MUSIC_RUNTIME.signatureSeconds,
      nonce: crypto.randomUUID(),
      assetId: null,
      bytes: 0,
      kind: null,
      mime: null,
      ...input,
    };
    const headers = await signatureHeaders(envelope, this.config.secret);
    headers["Content-Type"] =
      input.action === "upload"
        ? "application/octet-stream"
        : "application/json";
    const response = await fetch(this.config.bridgeUrl, {
      method: "POST",
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(MUSIC_RUNTIME.bridgeTimeoutMs),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (
        response.status >= 500 ||
        (response.status >= 300 && response.status < 400)
      )
        throw new MusicError(
          "UNAVAILABLE",
          "配信サーバーの応答を確認できません。状態確認・再試行してください。",
        );
      throw new MusicError(
        response.status === 409
          ? "CONFLICT"
          : response.status === 413
            ? "TOO_LARGE"
            : "INVALID",
        "配信サーバーが要求を拒否しました。入力・署名設定・反映版を確認してください。",
      );
    }
    return response;
  }
  /** @brief 小さな管理応答だけを上限付きでデコードする。 @param response bridge応答。 @returns 検証用JSON値。 */
  async json<T>(response: Response): Promise<T> {
    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        length += result.value.length;
        if (length > MUSIC_RUNTIME.jsonMaxBytes)
          throw new MusicError("UNAVAILABLE", "配信応答が上限を超えています。");
        chunks.push(result.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
    } finally {
      await reader.cancel();
    }
  }
  /** @brief 反映結果を型と元要求へ照合する。 @param value 外部結果。 @param expected 元操作。 @returns 確定receipt。 */
  verifyReceipt(
    value: Receipt,
    expected: {
      id: string;
      scope: string;
      digest: string;
      expected_revision: number;
    },
  ): Receipt {
    if (
      !value ||
      value.operationId !== expected.id ||
      value.scope !== expected.scope ||
      value.payloadDigest !== expected.digest ||
      value.revision !== expected.expected_revision + 1
    )
      throw new MusicError(
        "UNAVAILABLE",
        "配信結果が要求と一致しません。状態を再確認してください。",
      );
    return value;
  }
}
