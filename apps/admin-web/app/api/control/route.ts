import { recordOperation } from "@/lib/roles";
import type { SessionUser } from "@/lib/auth";
import { requireRecentIdentity } from "@/lib/auth";
import { assertBrowserWrite } from "@/lib/request-security";
import {
  requireRequester,
  authorizeRecovery,
  recoverPublication,
  cancelRequest,
  createRequest,
  createProductionRequest,
  dispatchRequest,
  reconcileCancelledRun,
  submitRequest,
} from "@/lib/control-plane";

// action プロパティをIDとして、ペイロードごとの型定義を分ける
type ControlAction =
  | { action: "recover_publication"; requestId: string; mode: string; reason: string }
  | { action: "create_request"; artifactId: string; gameId: string; version: string; artifactSha256: string; sizeBytes: number; fileCount: number }
  | { action: "create_production_request"; sourceStagingRequestId: string }
  | { action: "submit_request"; requestId: string; reason: string }
  | { action: "cancel_request"; requestId: string; reason: string }
  | { action: "authorize_recovery"; requestId: string; reason: string }
  | { action: "dispatch_request"; requestId: string }
  | { action: "reconcile_cancelled_run"; requestId: string };

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
async function execute(request: Request, capture: (actor: SessionUser, action: string, target: string) => void) {
  try {
    // CSRF 対策
    assertBrowserWrite(request);

    // 通常のログインだけでなく、直近で認証されたセッションを要求する
    // 重要な操作に対するセッションハイジャックを阻止
    // 実行者情報を取得
    const actor = await requireRecentIdentity(request);
    capture(actor,"control","");
    await requireRequester(actor);

    const payload = await request.json() as ControlAction;
    capture(actor, payload.action, "requestId" in payload ? payload.requestId : "");
    switch (payload.action) {
      case "recover_publication":
        return Response.json({ ok: true, ...await recoverPublication(actor,payload) });
      // ユーザーに対する権限の付与・はく奪

      //ゲームビルド等のアーティファクトを指定し、デプロイ申請を新規作成
      case "create_request":
        return Response.json({ ok: true, ...(await createRequest(actor, payload)) }, { status: 201 });

      // すでに検証済みのステージング申請をもとに、本番申請を作成
      case "create_production_request":
        return Response.json({ ok: true, ...(await createProductionRequest(actor, payload)) }, { status: 201 });

      // 申請に対する特定の承認者を氏名

      // 下書き状態の申請を正式に提出
      case "submit_request":
        await submitRequest(actor, payload);
        break;

      // 承認者による申請の承認または却下

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
      // GitHub側で確定したキャンセルを反映する
      case "reconcile_cancelled_run":
        await reconcileCancelledRun(actor, payload);
        break;
      default:
        return Response.json({ error: "不明な操作です" }, { status: 400 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

/** @brief 公開・復旧の全HTTP結果を実行者と対応させる */
export async function POST(request: Request) {
  let actor: SessionUser | null = null;
  let action = "control";
  let target = "";
  const response = await execute(request, (user,operation,id) => { actor = user; action = operation; target = id; });
  await recordOperation(actor, action, target, `http:${response.status}`);
  return response;
}
