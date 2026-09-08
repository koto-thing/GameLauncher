import { beginGithubFlow } from "@/lib/auth";

/**
 * GitHub OAuth 認証を開始するための GET エンドポイント
 * @param request リクエストヘッダー
 * @constructor
 */
export async function GET(request: Request) {
  try {
    // 認証フローを用意する
    const flow = await beginGithubFlow(request);
    // 生成されたGitHubのログイン・認可URLをセットしてユーザーのブラウザをGitHub側へ飛ばす
    // コールバック時の照合に使うための一時的な Cookie をブラウザに保存
    // 成功時に HTTP 302 を返す
    return new Response(null, {
      status: 302,
      headers: {
        location: flow.url,
        "set-cookie": flow.cookie,
      },
    });
  } catch (error) {
    // 設定不足や初期化失敗などでフローの開始に失敗した場合、HTTP 503を返す
    const message = error instanceof Error ? error.message : "GitHubログインを開始できません";
    return Response.json({ error: message }, { status: 503 });
  }
}
