import {
  githubAuthConfigured,
  localDevAuthAvailable,
  readSession,
  requireGameAccess,
} from "@/lib/auth";
import { getDashboard } from "@/lib/control-plane";

/**
 * 管理画面の初期表示用のデータを返却する API エンドポイント
 * @param request リクエストヘッダー
 * @constructor
 */
export async function GET(request: Request) {
  try {
    // リクエストの Cookie やヘッダーからログイン中のユーザーを取得
    // 未認証時は null
    const actor = await readSession(request);
    if (!actor) {
      // 認証されていない場合でも HTTP 200で認証関連メタデータを返す
      return Response.json({
        authenticated: false,
        githubAuthConfigured: githubAuthConfigured(),          // GitHub OAuthの環境変数や設定が有効か
        localDevAuthAvailable: localDevAuthAvailable(request), // ローカル開発用のバイパスが利用可能か
      });
    }

    // ログイン済みの場合、ユーザーに対象リソースへのアクセス権があるかを検証
    // 権限が不足している場合は関数内部で Response または、例外を投げる
    requireGameAccess(actor);
    return Response.json({
      authenticated: true,
      githubAuthConfigured: githubAuthConfigured(),
      localDevAuthAvailable: localDevAuthAvailable(request),
      dashboard: await getDashboard(actor),
    });
  } catch (error) {
    // requireGameAccess などが事前に生成した HTTP レスポンスを投げたときはそのまま返す
    if (error instanceof Response) return error;

    // そのほかは HTTP 500として返す
    const message = error instanceof Error ? error.message : "画面情報を取得できませんでした";
    return Response.json({ error: message }, { status: 500 });
  }
}
