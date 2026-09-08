import { requireUploaderActor } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/request-security";
import { issuePartUrls, recordPart } from "@/lib/intake";

type PartsRequest = {
  partNumbers?: number[];
  completed?: { partNumber: number; etag: string; sizeBytes: number };
};

/**
 * アーティファクトの分割アップロードを受け付ける API エンドポイント
 * @param request リクエストヘッダー
 * @param context コンテキスト
 * @constructor
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ artifactId: string }> },
) {
  try {
    // リクエストの Origin や Sec-Fetch-Site などを検証して、外部サイトからのクロスサイトリクエストを防ぐ
    assertSameOrigin(request);

    // 呼び出し元がアップロード権限をもつユーザーであることを確認する
    const actor = await requireUploaderActor(request);
    // URLパスから対象アーティファクトIDを取得
    const { artifactId } = await context.params;

    const payload = await request.json() as PartsRequest;
    // アップロード完了の記録
    if (payload.completed) {
      await recordPart(
        actor,
        artifactId,
        payload.completed.partNumber, // パート番号
        payload.completed.etag,       // 保存先ストレージから返された検証用ハッシュ
        payload.completed.sizeBytes,  // 実際に転送されたサイズ
      );

      // 成功時は HTTP 200を返す
      return Response.json({ ok: true });
    }

    // アップロード用URLの発行
    // issuePartUrls を呼び出して、各パートをアップロードするための URL を発行してクライアントへ返す
    return Response.json(await issuePartUrls(request, actor, artifactId, payload.partNumbers ?? []));
  } catch (error) {
    // 認証ガードやオリジンチェックが例外を投げたらそのまま返す
    if (error instanceof Response) return error;

    // パース失敗やDB例外は HTTP 400を返す
    return Response.json({ error: error instanceof Error ? error.message : "part情報を処理できませんでした" }, { status: 400 });
  }
}
