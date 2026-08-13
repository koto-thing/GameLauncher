import { githubPublicClientId, localDevAuthAvailable } from "@/lib/auth";
import { INTAKE_PART_SIZE, PRESIGNED_URL_SECONDS } from "@/lib/intake";

export async function GET(request: Request) {
  return Response.json({
    githubClientId: githubPublicClientId(),
    localDevelopment: localDevAuthAvailable(request),
    partSize: INTAKE_PART_SIZE,
    uploadUrlLifetimeSeconds: PRESIGNED_URL_SECONDS,
  });
}
