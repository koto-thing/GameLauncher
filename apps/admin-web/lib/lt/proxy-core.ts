import type { ApiError, ErrorCode, OperatorContext } from "../../../../contracts/lt/v1.ts";
import { assertBrowserWrite } from "../request-security.ts";

type Actor = OperatorContext;
export type LtInternalAdapter = { fetch(request: Request, actor: Actor): Promise<Response> };

// 既知の契約コードだけを通し、内部例外の本文やヘッダーを外へ出さない
const codes = new Set<ErrorCode>(["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "VALIDATION", "VERSION_CONFLICT", "DUPLICATE_APPLICATION", "RECRUITMENT_CLOSED", "CAPACITY_FULL", "INVALID_TRANSITION", "TOKEN_INVALID", "RATE_LIMITED", "RETENTION_EXPIRED", "SERVICE_UNAVAILABLE", "NOT_IMPLEMENTED"]);

/** @brief 管理エラーを共有DTOに絞って再構成する @param response 元の応答 @param requestId proxy発行ID @returns 非公開情報を除いたJSON応答 */
async function safeError(response: Response, requestId: string): Promise<Response> {
  const input = await response.json().catch(() => null);
  const fallback: ErrorCode = response.status === 401 ? "UNAUTHENTICATED" : response.status === 403 ? "FORBIDDEN" : response.status === 404 ? "NOT_FOUND" : response.status === 409 ? "VERSION_CONFLICT" : response.status === 429 ? "RATE_LIMITED" : response.status === 501 ? "NOT_IMPLEMENTED" : response.status === 503 ? "SERVICE_UNAVAILABLE" : "VALIDATION";
  const error: ApiError["error"] = { code: codes.has(input?.error?.code) ? input.error.code : fallback, requestId };
  // fieldsに値や説明を混ぜず、短い識別子だけを許可する
  if (Array.isArray(input?.error?.fields)) {
    error.fields = input.error.fields.filter((field: unknown): field is { path: string; code: string } => {
      if (!field || typeof field !== "object") return false;
      const item = field as Record<string, unknown>;
      return typeof item.path === "string" && /^[A-Za-z0-9_.[\]]{1,80}$/.test(item.path) && typeof item.code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(item.code);
    }).slice(0, 20).map((field: { path: string; code: string }) => ({ path: field.path, code: field.code }));
  }
  return Response.json({ error } satisfies ApiError, { status: response.status, headers: { "Cache-Control": "no-store, private" } });
}
/** @brief 最新の在籍と役割を検証し、内部専用アダプターへ渡す @param request ブラウザー要求 @param adapter 内部接続 @returns 非キャッシュ応答 */
export async function proxyLtCore(request: Request, authenticate: (request: Request) => Promise<{ githubUserId: string; role: string | null }>, adapter?: LtInternalAdapter): Promise<Response> {
  const requestId = crypto.randomUUID();
  try {
    // Cookie の署名、在籍、役割を既存認証で再検証する
    const user = await authenticate(request);
    if (user.role !== "admin" && user.role !== "executive" && user.role !== "assistant") {
      throw new Response("Forbidden", { status: 403 });
    }

    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/lt/v1/operator/")) throw new Response("Not found", { status: 404 });
    if (!["GET", "POST", "PATCH", "PUT"].includes(request.method)) throw new Response("Method not allowed", { status: 405 });
    if (request.method !== "GET") assertBrowserWrite(request);

    // 本人確認フローが確定するまでメール変更は接続しない
    if (/\/email-change(?:\/|$)/.test(url.pathname)) {
      if (user.role === "assistant") throw new Response("Forbidden", { status: 403 });
      throw new Response("本人確認フロー未確定のため未対応です", { status: 501 });
    }
    if (!adapter) throw new Response("LT 内部サービスは未接続です", { status: 503 });

    // ブラウザー由来の Cookie、Authorization、actor、role を内部へ転送しない
    const headers = new Headers();
    const contentType = request.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    const body = request.method === "GET" ? undefined : await request.arrayBuffer();
    if (body && body.byteLength > 65536) throw new Response("Too large", { status: 413 });
    if (body && !contentType?.startsWith("application/json")) throw new Response("JSON required", { status: 415 });
    const internal = new Request(`https://lt.internal${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      body,
      redirect: "error",
    });
    const result = await adapter.fetch(internal, { actorId: user.githubUserId, role: user.role, requestId });
    if (!result.ok) return safeError(result, requestId);
    return new Response(result.body, { status: result.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store, private" } });
  } catch (error) {
    const response = error instanceof Response ? error : new Response("Unavailable", { status: 503 });
    return safeError(response, requestId);
  }
}
