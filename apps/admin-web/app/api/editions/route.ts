import { requireRecentSession } from "@/lib/auth";
import { assertBrowserWrite } from "@/lib/request-security";
import { buildEdition, createEdition, editionDashboard, requireEditionAdmin } from "@/lib/physical-editions";

/** @brief 配布版管理一覧を認証済み管理者へ返す */
export async function GET(request: Request) {
  try {
    return Response.json(await editionDashboard(await requireRecentSession(request)));
  } catch (error) { return failure(error); }
}

/** @brief 配布版の固定作成またはビルドを受け付ける */
export async function POST(request: Request) {
  try {
    assertBrowserWrite(request);
    const actor = await requireRecentSession(request);
    await requireEditionAdmin(actor);
    const limited = await boundedBody(request);
    if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
      return Response.json(await createEdition(actor, await limited.formData()), { status: 201 });
    }
    const input = await limited.json() as { editionId: string };
    return Response.json(await buildEdition(actor, input.editionId), { status: 202 });
  } catch (error) { return failure(error); }
}

/** @brief Content-Lengthの有無にかかわらず受信本文を5 MiBに制限する */
async function boundedBody(request: Request): Promise<Response> {
  const limit = 5 * 1024 * 1024;
  if (Number(request.headers.get("content-length")) > limit) throw new Error("画像容量が大きすぎます");
  const reader = request.body?.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          await reader.cancel();
          throw new Error("画像容量が大きすぎます");
        }
        chunks.push(new Uint8Array(value));
      }
    } finally { reader.releaseLock(); }
  }
  return new Response(new Blob(chunks), { headers: { "content-type": request.headers.get("content-type") ?? "application/json" } });
}

/** @brief API失敗を利用者向けJSONへ変換する */
function failure(error: unknown) {
  if (error instanceof Response) return Response.json({ error: error.status === 401 ? "ログインし直してください" : "管理者だけが利用できます" }, { status: error.status });
  return Response.json({ error: error instanceof Error ? error.message : "配布版を処理できません" }, { status: 400 });
}
