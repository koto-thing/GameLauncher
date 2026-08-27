import { requireUploaderActor } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/request-security";
import { createOrResumeUpload, type ArtifactDescriptor } from "@/lib/intake";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireUploaderActor(request);
    const descriptor = await request.json() as ArtifactDescriptor;
    return Response.json(await createOrResumeUpload(actor, descriptor), { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "uploadを開始できませんでした" }, { status: 400 });
  }
}
