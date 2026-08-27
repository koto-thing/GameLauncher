import { preflightRequest, recordPreflightRejection, requireActionsIdentity } from "@/lib/actions";

export async function POST(request: Request) {
  let identity;
  let input: { requestId: string; attemptId: string } | undefined;
  try {
    identity = await requireActionsIdentity(request, false);
    input = await request.json() as { requestId: string; attemptId: string };
    return Response.json(await preflightRequest(identity, input));
  } catch (error) {
    if (error instanceof Response) return error;
    if (identity && input) await recordPreflightRejection(identity, input);
    return Response.json({ error: error instanceof Error ? error.message : "preflightに失敗しました" }, { status: 400 });
  }
}
