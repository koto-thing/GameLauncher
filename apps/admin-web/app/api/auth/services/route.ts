import { env } from "cloudflare:workers";
import { readSession } from "@/lib/auth";
import { getD1 } from "@/db/initialize";
import { musicPrincipal } from "@/music/infrastructure/authorization";

/** @brief 共通ナビへ機能の可否だけを返しゲームデータを取得しない。 @param request 共通Cookie。 @returns 利用可能なサービス。 */
export async function GET(request: Request): Promise<Response> {
  const user = await readSession(request);
  let music = false;
  if (user && (env as Record<string, unknown>).MUSIC_ENABLED === "true") {
    try { music = Boolean(await musicPrincipal(getD1(), user)); }
    catch { /* Music未設定・障害でもゲームの入口を表示できる。 */ }
  }
  return Response.json({ game: user?.gameAccess === true, music }, { headers: { "Cache-Control": "no-store, private" } });
}
