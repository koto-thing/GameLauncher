import { requireUploaderActor } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/request-security";
import { createOrResumeUpload, type ArtifactDescriptor } from "@/lib/intake";

export async function POST(request: Request) {
  try {
    // CSRF対策
    assertSameOrigin(request);

    // アップローダーの権限の検証
    const actor = await requireUploaderActor(request);

    // クライアントから送信されたファイルのメタデータを受け取る
    const descriptor = await request.json() as ArtifactDescriptor;
    // 新規アップロード時：artifactIdを発行して、S3 等のストレージに対して CreateMultipartUpload を発行、またはローカル一時ディレクトリを作成してDBにステータスを保存
    // 中断から再開時：同じファイル定義のセッションがすでに存在する場合、既存の artifactId とすでにアップロード完了済みのパート一覧を返し、未送信のパートだけを続行できるようにする
    // 成功時は HTTP 201を返す
    return Response.json(await createOrResumeUpload(actor, descriptor), { status: 201 });
  } catch (error) {
    // 例外はそのまま返す
    if (error instanceof Response) return error;

    // そのほかは HTTP 400を返す
    return Response.json({ error: error instanceof Error ? error.message : "uploadを開始できませんでした" }, { status: 400 });
  }
}
