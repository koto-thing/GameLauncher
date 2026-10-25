import { requireRecentIdentity } from "@/lib/auth";
import { assertBrowserWrite } from "@/lib/request-security";

type Actor = { id: string; role: "admin" | "executive" | "assistant" };
export type LtInternalAdapter = { fetch(request: Request, actor: Actor): Promise<Response> };

/** @brief 最新の在籍と役割を検証し、内部専用アダプターへ渡す @param request ブラウザー要求 @param adapter 内部接続 @returns 非キャッシュ応答 */
export async function proxyLt(request: Request, adapter?: LtInternalAdapter): Promise<Response> {
  try {
    // Cookie の署名、在籍、役割を既存認証で再検証する
    const user = await requireRecentIdentity(request);
    if (user.role !== "admin" && user.role !== "executive" && user.role !== "assistant") {
      throw new Response("Forbidden", { status: 403 });
    }

    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/lt/v1/operator/")) throw new Response("Not found", { status: 404 });
    if (!["GET", "POST", "PATCH", "PUT"].includes(request.method)) throw new Response("Method not allowed", { status: 405 });
    if (request.method !== "GET") assertBrowserWrite(request);

    // 本人確認フローが確定するまでメール変更は接続しない
    if (url.pathname.includes("/email-change/")) {
      if (user.role === "assistant") throw new Response("Forbidden", { status: 403 });
      throw new Response("本人確認フロー未確定のため未対応です", { status: 501 });
    }
    if (!adapter) throw new Response("LT 内部サービスは未接続です", { status: 503 });

    // ブラウザー由来の Cookie、Authorization、actor、role を内部へ転送しない
    const headers = new Headers();
    const contentType = request.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    const internal = new Request(`https://lt.internal${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      body: request.method === "GET" ? undefined : await request.arrayBuffer(),
      redirect: "error",
    });
    const result = await adapter.fetch(internal, { id: user.githubUserId, role: user.role });
    return new Response(result.body, { status: result.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store, private" } });
  } catch (error) {
    const response = error instanceof Response ? error : new Response("Unavailable", { status: 503 });
    response.headers.set("Cache-Control", "no-store, private");
    return response;
  }
}
