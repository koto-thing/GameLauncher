import { requireUploaderActor } from "@/lib/auth";
import { uploadLocalPart } from "@/lib/intake";

export async function PUT(
  request: Request,
  context: { params: Promise<{ artifactId: string; partNumber: string }> },
) {
  try {
    const actor = await requireUploaderActor(request);
    const { artifactId, partNumber: partText } = await context.params;
    const contentLength = Number(request.headers.get("content-length"));
    const uploaded = await uploadLocalPart(
      actor,
      artifactId,
      Number(partText),
      request.body,
      contentLength,
    );
    return Response.json(uploaded);
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "partをuploadできませんでした" }, { status: 400 });
  }
}
