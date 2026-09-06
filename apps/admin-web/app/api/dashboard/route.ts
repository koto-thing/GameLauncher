import {
  githubAuthConfigured,
  localDevAuthAvailable,
  readSession,
  requireGameAccess,
} from "@/lib/auth";
import { getDashboard } from "@/lib/control-plane";

export async function GET(request: Request) {
  try {
    const actor = await readSession(request);
    if (!actor) {
      return Response.json({
        authenticated: false,
        githubAuthConfigured: githubAuthConfigured(),
        localDevAuthAvailable: localDevAuthAvailable(request),
      });
    }
    requireGameAccess(actor);
    return Response.json({
      authenticated: true,
      githubAuthConfigured: githubAuthConfigured(),
      localDevAuthAvailable: localDevAuthAvailable(request),
      dashboard: await getDashboard(actor),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : "画面情報を取得できませんでした";
    return Response.json({ error: message }, { status: 500 });
  }
}
