import { readSession } from "@/lib/auth";

/** @brief 画面を開いたまま期限を迎えたセッションも共通入口で検出する */
export async function GET(request: Request): Promise<Response> {
  const user = await readSession(request);

  return Response.json({ authenticated: Boolean(user) }, { status: user ? 200 : 401, headers: { "Cache-Control": "no-store, private" } });
}
