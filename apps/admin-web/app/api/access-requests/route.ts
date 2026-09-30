import { githubAuthConfigured, localDevAuthAvailable, readSession, requireRecentIdentity } from "@/lib/auth";
import { accessService, decideAccessRequest, listAccessRequests, submitAccessRequest } from "@/lib/access-requests";
import { assertBrowserWrite } from "@/lib/request-security";

/** @brief 申請APIのエラーから内部DB情報やGitHub応答を公開しない */
function errorResponse(error: unknown): Response {
  if (error instanceof Response) return error;
  return Response.json({ error: "処理を完了できませんでした。設定または接続状況を確認して再試行してください" }, { status: 503 });
}

/** @brief ログイン案内、自分の申請、または権限のあるサービスの審査一覧を返す */
export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await readSession(request);
    const config = { githubAuthConfigured: githubAuthConfigured(), localDevAuthAvailable: localDevAuthAvailable(request) };
    if (!actor) return Response.json({ user: null, ...config });
    const url = new URL(request.url);
    const service = accessService(url.searchParams.get("service") ?? "game");
    const result = await listAccessRequests(actor, service, url.searchParams.get("review") === "true");
    return Response.json({ ...result, ...config, user: { login: actor.login, avatarUrl: actor.avatarUrl } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** @brief 同一originと直近の本人確認を満たす申請・審査だけを受け付ける */
export async function POST(request: Request): Promise<Response> {
  try {
    assertBrowserWrite(request);
    const actor = await requireRecentIdentity(request);
    const raw = await request.text();
    if (raw.length > 8000) return Response.json({ error: "入力が長すぎます" }, { status: 413 });
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(raw);
    } catch {
      return Response.json({ error: "JSONが不正です" }, { status: 400 });
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) return Response.json({ error: "入力が不正です" }, { status: 400 });
    if (input.action === "submit") return Response.json({ ok: true, ...await submitAccessRequest(actor, input) }, { status: 201 });
    if (input.action === "decide") {
      await decideAccessRequest(actor, input);
      return Response.json({ ok: true });
    }
    return Response.json({ error: "操作が不正です" }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
