import { requireActionsIdentity } from "@/lib/actions-identity";
import { editionPreflight, editionStatus } from "@/lib/physical-editions";

/** @brief 配布版Workflow専用のOIDC認証でビルド情報を交換する */
export async function POST(request: Request) {
  try {
    const identity = await requireActionsIdentity(request, true, "edition");
    const input = await request.json() as {
      action: string; editionId: string; buildId: string; state: string;
      snapshot?: unknown; artifactId?: string; error?: string;
    };
    if (input.action === "preflight") return Response.json(await editionPreflight(identity, input.editionId, input.buildId));
    if (input.action !== "status") throw new Error("不明な操作です");
    await editionStatus(identity, input);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return Response.json({ error: await error.text() }, { status: error.status });
    return Response.json({ error: error instanceof Error ? error.message : "ビルド情報を処理できません" }, { status: 400 });
  }
}
