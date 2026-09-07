import { githubPublicClientId, localDevAuthAvailable } from "@/lib/auth";
import { INTAKE_PART_SIZE, PRESIGNED_URL_SECONDS } from "@/lib/intake";

/**
 * 認証の初期化および、アーティファクトのアップロード準備を行うために必要な効果設定値・定数を取得する API エンドポイント
 * @param request リクエストヘッダー
 * @constructor
 */
export async function GET(request: Request) {
  return Response.json({
    githubClientId: githubPublicClientId(),           // GitHub OAuth 認証を開始する際の認可 URL のパラメータとして使用する公開クライアントID
    localDevelopment: localDevAuthAvailable(request), // 現在のリクエスト環境でモック認証やバイパスログインUIを表示してもよいか
    partSize: INTAKE_PART_SIZE,                       // アーティファクトを分割アップロードする際の1分割あたりのバイトサイズ
    uploadUrlLifetimeSeconds: PRESIGNED_URL_SECONDS,  // S3 や Cloud Storage 等の署名付き URL の有効期限
  });
}
