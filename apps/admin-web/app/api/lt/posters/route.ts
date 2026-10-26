import { env } from "cloudflare:workers";
import { requireRecentIdentity } from "@/lib/auth";
import { assertBrowserWrite } from "@/lib/request-security";
import { posterType, readPoster } from "@/lib/lt/poster-upload";

/** @brief LT運営権限を検証しポスター専用ストレージへ画像を保存する */
export async function POST(request: Request): Promise<Response> {
  try {
    assertBrowserWrite(request);
    const actor = await requireRecentIdentity(request);
    if (!["admin","executive","assistant"].includes(actor.role ?? "")) return new Response("Forbidden",{status:403});
    const bucket = (env as unknown as { LT_POSTERS: R2Bucket }).LT_POSTERS;
    if (!bucket) return new Response("アップロードを利用できません",{status:503});
    const bytes = await readPoster(request);
    const type = posterType(bytes);
    if (!type || type !== request.headers.get("content-type")) return new Response("PNG・JPEG・WebPの画像を選択してください",{status:415});
    const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
    const id = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,"0")).join("");
    await bucket.put(id, bytes, {httpMetadata:{contentType:type}});
    return Response.json({url:new URL(`/media/lt-posters/${id}`,request.url).href},{status:201});
  } catch(error) {
    if (error instanceof Response) return error;
    return new Response("アップロードに失敗しました。もう一度お試しください",{status:503});
  }
}
