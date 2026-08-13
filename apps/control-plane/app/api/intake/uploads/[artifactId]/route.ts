import { requireUploaderActor } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/request-security";
import { cancelUpload } from "@/lib/intake";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ artifactId: string }> },
) {
  try {
    assertSameOrigin(request);
    const actor = await requireUploaderActor(request);
    const { artifactId } = await context.params;
    await cancelUpload(actor, artifactId);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "uploadをキャンセルできませんでした" }, { status: 400 });
  }
}
