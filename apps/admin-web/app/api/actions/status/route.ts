import { recordActionsStatus, requireActionsIdentity } from "@/lib/actions";

export async function POST(request: Request) {
  try {
    const input = await request.json() as {
      requestId: string;
      attemptId: string;
      stage: string;
      result?: string;
      manifestSha256?: string;
      publishedObjectCount?: number;
    };
    const identity = await requireActionsIdentity(request, input.stage !== "preflight");
    await recordActionsStatus(identity, input);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "status callbackに失敗しました" }, { status: 400 });
  }
}
