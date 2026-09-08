import { preflightRequest, recordPreflightRejection, requireActionsIdentity } from "@/lib/actions";

/**
 * POSTリクエストハンドラ
 * @param request リクエストヘッダー
 * @constructor
 */
export async function POST(request: Request) {
  let identity;                                                    // リクエストヘッダーやセッション
  let input: { requestId: string; attemptId: string } | undefined; // RequestID と AttemptID

  try {
    // リクエストヘッダーやセッションから実行元を検証・取得する
    identity = await requireActionsIdentity(request, false);
    // POST された JSON から RequestID と AttemptID を取得
    input = await request.json() as { requestId: string; attemptId: string };

    // 200を返す
    return Response.json(await preflightRequest(identity, input));
  } catch (error) {
    // エラーをそのまま返すか、ログとして拒否理由を記録
    if (error instanceof Response) return error;
    if (identity && input) await recordPreflightRejection(identity, input);

    // 最終的に 400 で error の JSON を返す
    return Response.json({ error: error instanceof Error ? error.message : "preflightに失敗しました" }, { status: 400 });
  }
}
