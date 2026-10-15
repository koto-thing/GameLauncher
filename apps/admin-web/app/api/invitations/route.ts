import { requireInvitationIdentity, createSessionCookie, type SessionUser } from "@/lib/auth";
import { pendingInvitation } from "@/lib/operator-access";
import { acceptInvitation } from "@/lib/members";
import { assertBrowserWrite } from "@/lib/request-security";
import { recordOperation } from "@/lib/roles";

/** @brief 限定セッションの本人宛招待一件だけを返す */
export async function GET(request: Request) {
  try {
    const actor = await requireInvitationIdentity(request);
    return Response.json(await pendingInvitation(actor.githubUserId,actor.login,actor.invitationId), { headers: { "Cache-Control":"no-store, private" } });
  } catch (error) { return error instanceof Response ? error : new Response("Unavailable",{status:503}); }
}

/** @brief 招待受諾が完了した後だけ通常の運営セッションを発行する */
export async function POST(request: Request) {
  let actor: SessionUser | null = null;
  try {
    assertBrowserWrite(request);
    actor = await requireInvitationIdentity(request);
    const raw = await request.text();
    if (raw.length > 1024) throw new Response("Too large",{status:413});
    const input = JSON.parse(raw);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Response("Invalid input",{status:400});
    const user = await acceptInvitation(actor,input);
    return Response.json({ok:true},{headers:{"set-cookie":await createSessionCookie(user,request),"Cache-Control":"no-store"}});
  } catch (error) {
    await recordOperation(actor,"invitation.accept","",error instanceof Response ? `rejected:${error.status}` : "failed");
    return error instanceof Response ? error : new Response("Request failed",{status:400});
  }
}
