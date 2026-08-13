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

function errorResponse(error: unknown): Response {
  if (error instanceof Response) {
    const message = error.status === 401 ? "ログインが必要です" : "この操作は許可されていません";
    return Response.json({ error: message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "操作を完了できませんでした";
  return Response.json({ error: message }, { status: 400 });
}

export async function POST(request: Request) {
  try {
    assertBrowserWrite(request);
    const actor = await requireRecentSession(request);
    const payload = await request.json() as ControlAction;
    switch (payload.action) {
      case "set_grant":
        await setGrant(actor, payload);
        break;
      case "create_request":
        return Response.json({ ok: true, ...(await createRequest(actor, payload)) }, { status: 201 });
      case "create_production_request":
        return Response.json({ ok: true, ...(await createProductionRequest(actor, payload)) }, { status: 201 });
      case "designate_approver":
        await designateApprover(actor, payload);
        break;
      case "submit_request":
        await submitRequest(actor, payload);
        break;
      case "decide_request":
        await decideRequest(actor, payload);
        break;
      case "cancel_request":
        await cancelRequest(actor, payload);
        break;
      case "authorize_recovery":
        await authorizeRecovery(actor, payload);
        break;
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
