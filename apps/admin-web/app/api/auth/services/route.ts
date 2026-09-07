import { env } from "cloudflare:workers";
import { readSession } from "@/lib/auth";
import { getD1 } from "@/db/initialize";
import { musicPrincipal } from "@/music/infrastructure/authorization";

/**
 * @brief 共通ナビへ機能の可否だけを返しゲームデータを取得しない
 * @param request 共通Cookie
 * @returns 利用可能なサービス
 */
export async function GET(request: Request): Promise<Response> {
  // リクエストから現在のログインユーザー情報を取得
  const user = await readSession(request);

  let music = false;
  // ユーザーがログインしている、システム全体で音楽機能が有効化されているかチェック
  if (user && (env as Record<string, unknown>).MUSIC_ENABLED === "true") {

    try {
      // Cloudflare D1 データベースを参照して、音楽機能の権限主体が存在するかチェック
      // 存在する場合は、music = trueにする
      music = Boolean(await musicPrincipal(getD1(), user));
    } catch {
      /* Music未設定・障害でもゲームの入口を表示 */
      /* 障害対策用 */
    }
  }

  // レスポンスを返す
  // ブラウザやCDN等に結果をキャッシュさせない
  return Response.json({ game: user?.gameAccess === true, music }, { headers: { "Cache-Control": "no-store, private" } });
}
