import { requireUploaderActor } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/request-security";
import { sealUpload } from "@/lib/intake";

/**
 * 分割アップロードを完了・♰封印♰するための API エンドポイント
 * @param request
 * @param context
 * @constructor
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ artifactId: string }> },
) {
  try {
    // CSRF対策
    assertSameOrigin(request);

    // ログイン中のユーザーがアップロード権限を持っているかを確認
    const actor = await requireUploaderActor(request);
    const { artifactId } = await context.params;

    // これまでに記録されたパートに抜けているところがないかをチェックし、S3などに CompleteMultipartUploadを発行、またはローカル環境でファイルを結合
    // 全体ファイルの SHA-256 チェック
    // アーティファクトの状態を"アップロード中"から"♰封印♰済み・検証完了"へ遷移させて以降のパート追加・改ざんを防止
    return Response.json(await sealUpload(actor, artifactId));
  } catch (error) {
    // 例外をなげたらそのまま返す
    if (error instanceof Response) return error;

    // パートの欠落やハッシュ不一致、DB更新失敗時は HTTP 400を返す
    return Response.json({ error: error instanceof Error ? error.message : "artifactをsealできませんでした" }, { status: 400 });
  }
}
