import { requireUploaderActor } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/request-security";
import { sealUpload } from "@/lib/intake";

export async function POST(
  request: Request,
  context: { params: Promise<{ artifactId: string }> },
) {
  try {
    assertSameOrigin(request);
    const actor = await requireUploaderActor(request);
    const { artifactId } = await context.params;
    return Response.json(await sealUpload(actor, artifactId));
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "artifactをsealできませんでした" }, { status: 400 });
  }
}
