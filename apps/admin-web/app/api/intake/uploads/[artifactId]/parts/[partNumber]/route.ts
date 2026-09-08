import { requireUploaderActor } from "@/lib/auth";
import { uploadLocalPart } from "@/lib/intake";

/**
 * アーティファクトの分割アップロードを受け付ける API エンドポイント
 * @param request リクエストヘッダー
 * @param context コンテキスト
 * @constructor
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ artifactId: string; partNumber: string }> },
) {
  try {
    // 呼び出し元がアップロード権限を持つユーザーであるかを検証して、未認可のリクエストを遮断
    const actor = await requireUploaderActor(request);

    // URL パスから対象アーティファクトIDとチャンク番号を取り出す
    const { artifactId, partNumber: partText } = await context.params;
    // request.headers.get("content-length") を取得して、数値にパース可能か判定
    // 不整値なら null
    const rawContentLength = request.headers.get("content-length");
    const contentLength = rawContentLength !== null && !Number.isNaN(Number(rawContentLength))
      ? Number(rawContentLength)
      : null;

    // メモリ枯渇を防ぐため、request.body をそのまま渡す
    // 保存が完了すると、アップロード結果メタデータが返される
    const uploaded = await uploadLocalPart(
      actor,
      artifactId,
      Number(partText),
      request.body,
      contentLength,
    );

    // 成功時は HTTP 200を返す
    return Response.json(uploaded);
  } catch (error) {
    // 認証ガード等が例外を投げたらそのまま返す
    if (error instanceof Response) return error;

    // パース失敗やストレージ書き込みエラーは HTTP 400を返す
    return Response.json({ error: error instanceof Error ? error.message : "partをuploadできませんでした" }, { status: 400 });
  }
}
