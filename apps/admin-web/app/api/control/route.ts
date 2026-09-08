import { requireRecentSession } from "@/lib/auth";
import { assertBrowserWrite } from "@/lib/request-security";
import {
  authorizeRecovery,
  cancelRequest,
  createRequest,
  createProductionRequest,
  decideRequest,
  designateApprover,
  dispatchRequest,
  setGrant,
  submitRequest,
  type GrantType,
} from "@/lib/control-plane";

// action プロパティをIDとして、ペイロードごとの型定義を分ける
type ControlAction =
  | { action: "set_grant"; githubUserId: string; login: string; grantType: GrantType; enabled: boolean }
  | { action: "create_request"; artifactId: string; gameId: string; version: string; artifactSha256: string; sizeBytes: number; fileCount: number }
  | { action: "create_production_request"; sourceStagingRequestId: string }
  | { action: "designate_approver"; requestId: string; approverGithubUserId: string }
  | { action: "submit_request"; requestId: string; reason: string }
  | { action: "decide_request"; requestId: string; decision: "approved" | "rejected"; reason: string }
  | { action: "cancel_request"; requestId: string; reason: string }
  | { action: "authorize_recovery"; requestId: string; reason: string }
  | { action: "dispatch_request"; requestId: string };

/**
 * 異常系レスポンス
 * @param error
 */
function errorResponse(error: unknown): Response {
  // 認証・認可ライブラリが Response オブジェクトを直接投げたら、そのステータスコードを維持しながらメッセージに変換
  if (error instanceof Response) {
    const message = error.status === 401 ? "ログインが必要です" : "この操作は許可されていません";
    return Response.json({ error: message }, { status: error.status });
  }

  // 通常の例外は HTTP 400として、エラー内容を返す
  const message = error instanceof Error ? error.message : "操作を完了できませんでした";
  return Response.json({ error: message }, { status: 400 });
}

/**
 * デプロイ・リリース管理の POST エンドポイント
 * @param request リクエストヘッダー1
 * @constructor
 */
export async function POST(request: Request) {
  try {
    // CSRF 対策
    assertBrowserWrite(request);

    // 通常のログインだけでなく、直近で認証されたセッションを要求する
    // 重要な操作に対するセッションハイジャックを阻止
    // 実行者情報を取得
    const actor = await requireRecentSession(request);

    const payload = await request.json() as ControlAction;
    switch (payload.action) {
      // ユーザーに対する権限の付与・はく奪
      case "set_grant":
        await setGrant(actor, payload);
        break;

      //ゲームビルド等のアーティファクトを指定し、デプロイ申請を新規作成
      case "create_request":
        return Response.json({ ok: true, ...(await createRequest(actor, payload)) }, { status: 201 });

      // すでに検証済みのステージング申請をもとに、本番申請を作成
      case "create_production_request":
        return Response.json({ ok: true, ...(await createProductionRequest(actor, payload)) }, { status: 201 });

      // 申請に対する特定の承認者を氏名
      case "designate_approver":
        await designateApprover(actor, payload);
        break;

      // 下書き状態の申請を正式に提出
      case "submit_request":
        await submitRequest(actor, payload);
        break;

      // 承認者による申請の承認または却下
      case "decide_request":
        await decideRequest(actor, payload);
        break;

      // 申請者等による申請の取り下げ
      case "cancel_request":
        await cancelRequest(actor, payload);
        break;

      // 障害時等の緊急リカバリ・ロールバック等の特別承認
      case "authorize_recovery":
        await authorizeRecovery(actor, payload);
        break;

      // 承認された申請を実行エンジンへディスパッチ
      case "dispatch_request":
        return Response.json({ ok: true, ...(await dispatchRequest(actor, payload)) });
      default:
        return Response.json({ error: "不明な操作です" }, { status: 400 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
