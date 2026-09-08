import { recordActionsStatus, requireActionsIdentity } from "@/lib/actions";

/**
 * 非同期ジョブやワークフローの進行状況・完了結果を受け取るステータスコールバック
 * @param request リクエストヘッダー
 * @constructor
 */
export async function POST(request: Request) {
  try {
    const input = await request.json() as {
      requestId: string;             // 対象の実行単位ID
      attemptId: string;             // 対象の実行単位ID
      stage: string;                 // 現在のフェーズ (preflightとか)
      result?: string;               // 実行結果のステータスまたは、メッセージ
      manifestSha256?: string;       // 生成物のハッシュ値
      publishedObjectCount?: number; // 公開・生成された成果物の件数
    };

    // DEBUG: input.stage が preflight なら認証要件を弱める
    // 検証された identity と input をデータベースや監査ログに保存
    const identity = await requireActionsIdentity(request, input.stage !== "preflight");
    await recordActionsStatus(identity, input);

    // HTTP 200を返す
    return Response.json({ ok: true });
  } catch (error) {
    // Response が投げられたらそのまま、それ以外はHTTP 400
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "status callbackに失敗しました" }, { status: 400 });
  }
}
