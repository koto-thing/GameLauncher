import { requireUploaderActor } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/request-security";
import { cancelUpload } from "@/lib/intake";

/**
 * 途中で失敗・中断した分割アップロードを取り消し、ゴミデータを削除する API エンドポイント
 * @param request リクエストヘッダー
 * @param context コンテキスト
 * @constructor
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ artifactId: string }> },
) {
  try {
    // CSRF対策
    assertSameOrigin(request);

    // アップローダー権限をチェック
    const actor = await requireUploaderActor(request);

    // URL パスからキャンセル対象のアーティファクトIDを取得
    const { artifactId } = await context.params;
    // マルチパートアップロード中断APIを呼び出して、すでにストレージ上に蓄積された不完全なパートデータを削除
    // ローカル開発環境の場合、ディスク上に一時保存されたチャンクファイル群を削除
    // データベースやセッション上のアップロード管理レコードをキャンセル済みに更新、またはレコード自体を削除
    await cancelUpload(actor, artifactId);

    // HTTP 200を返す
    return Response.json({ ok: true });
  } catch (error) {
    // 例外はそのまま返す
    if (error instanceof Response) return error;

    // そのほかは HTTP 400を返す
    return Response.json({ error: error instanceof Error ? error.message : "uploadをキャンセルできませんでした" }, { status: 400 });
  }
}
