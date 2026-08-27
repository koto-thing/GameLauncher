import { requireUploaderActor } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/request-security";
import { issuePartUrls, recordPart } from "@/lib/intake";

type PartsRequest = {
  partNumbers?: number[];
  completed?: { partNumber: number; etag: string; sizeBytes: number };
};

export async function POST(
  request: Request,
  context: { params: Promise<{ artifactId: string }> },
) {
  try {
    assertSameOrigin(request);
    const actor = await requireUploaderActor(request);
    const { artifactId } = await context.params;
    const payload = await request.json() as PartsRequest;
    if (payload.completed) {
      await recordPart(
        actor,
        artifactId,
        payload.completed.partNumber,
        payload.completed.etag,
        payload.completed.sizeBytes,
      );
      return Response.json({ ok: true });
    }
    return Response.json(await issuePartUrls(request, actor, artifactId, payload.partNumbers ?? []));
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "part情報を処理できませんでした" }, { status: 400 });
  }
}
