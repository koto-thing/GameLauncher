import { requireRecentIdentity, type SessionUser } from "@/lib/auth";
import { assertBrowserWrite } from "@/lib/request-security";
import { memberDashboard, inviteMember, revokeInvitation, changeRole } from "@/lib/members";
import { lookupGithubUser } from "@/lib/operator-access";
import { requirePermission, recordOperation } from "@/lib/roles";

/** @brief 個人の招待と認可済み管理一覧をキャッシュせず返す */
export async function GET(request: Request) {
  try {
    return Response.json(await memberDashboard(await requireRecentIdentity(request)), { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    return error instanceof Response ? error : new Response("Unavailable", { status: 503 });
  }
}

/** @brief 招待・受諾・役割変更を毎回認可し、拒否と失敗も記録する */
export async function POST(request: Request) {
  let actor: SessionUser | null = null;
  let action = "members";
  try {
    assertBrowserWrite(request);
    actor = await requireRecentIdentity(request);
    const raw = await request.text();
    if (raw.length > 2048) throw new Response("Too large", { status: 413 });
    const input = JSON.parse(raw) as Record<string, unknown>;
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Response("Invalid input", { status: 400 });
    action = String(input.action).slice(0,40);
    if (action === "lookup") {
      await requirePermission(actor,"invite");
      return Response.json(await lookupGithubUser(input.login));
    }
    if (action === "invite" || action === "reapprove") return Response.json(await inviteMember(actor,input), { status: 201 });
    if (action === "revoke_invitation") await revokeInvitation(actor,input);
    else if (action === "set_role") await changeRole(actor,input);
    else throw new Response("Unknown action", { status: 400 });
    return Response.json({ ok: true });
  } catch (error) {
    await recordOperation(actor,action,"",error instanceof Response ? `rejected:${error.status}` : "failed");
    return error instanceof Response ? error : new Response("Request failed", { status: 400 });
  }
}
