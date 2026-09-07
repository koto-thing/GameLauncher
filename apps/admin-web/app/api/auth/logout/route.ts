import { clearSessionCookie } from "@/lib/auth";
import { assertBrowserWrite } from "@/lib/request-security";

/**
 * ログアウト処理を実行するための POST エンドポイント
 * @param request リクエストヘッダー
 * @constructor
 */
export async function POST(request: Request) {
  try {
    // POST リクエストが意図した正規のブラウザ操作によるものかを検証
    // Origin や Referer ヘッダー、CSRFトークンなどをチェックして、外部サイトからのCSRF攻撃をはじく
    assertBrowserWrite(request);
    // ブラウザに保存されているセッション Cookie の有効期限を過去の日時に設定し、Cookie を削除
    return new Response(null, {
      status: 204,
      headers: { "set-cookie": clearSessionCookie(request) },
    });
  } catch (error) {
    // assertBrowserWrite がエラーを投げたらそれをそのまま返す
    // それ以外は HTTP 400を返す
    return error instanceof Response ? error : new Response("Logout failed", { status: 400 });
  }
}
