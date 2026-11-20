import { getD1 } from "@/db/initialize";
import { requireSession } from "@/lib/auth";
import { PUBLISHED_GAME_ENVIRONMENTS } from "@/lib/published-game-profile";

const origin = PUBLISHED_GAME_ENVIRONMENTS[0].baseUrl;

/**
 * 本番のOS別カタログと最新マニフェストを照合し、停止対象の申請を関連付ける
 * @param request 管理者セッションを含むリクエスト
 * @returns 配信中の版と取得できなかった配信先
 */
export async function GET(request: Request) {
  try {
    await requireSession(request);
    const records = await getD1().prepare(`SELECT request_id, game_id, version,
      json_extract(metadata_json,'$.platform') AS platform, json_extract(metadata_json,'$.arch') AS arch
      FROM deployment_requests WHERE environment='production' AND state='succeeded'
      ORDER BY created_at DESC`).all<{ request_id: string; game_id: string; version: string; platform: string; arch: string }>();
    const games = [];
    const errors = [];

    // カタログ未作成の配信先は空とし、通信障害は個別に表示する
    for (const platform of ["linux", "windows", "macos"]) {
      for (const arch of ["x86_64", "arm64"]) {
        try {
          const catalog = await fetch(`${origin}/v1/catalog/ja-JP/${platform}/${arch}.json`, { cache: "no-store" });
          if (catalog.status === 404) continue;
          if (!catalog.ok) throw new Error();
          const entries = (await catalog.json() as { games: { gameId: string; name: string }[] }).games;
          for (const { gameId, name } of entries) {
            let version: string | null = null;
            try {
              const latest = await fetch(`${origin}/v1/games/${encodeURIComponent(gameId)}/releases/${platform}/${arch}/latest.json`, { cache: "no-store" });
              if (!latest.ok) throw new Error();
              const manifest = await latest.json() as { gameId: string; platform: string; arch: string; version: string };
              if (manifest.gameId !== gameId || manifest.platform !== platform || manifest.arch !== arch ||
                  typeof manifest.version !== "string") throw new Error();
              version = manifest.version;
            } catch {
              errors.push(`${name}（${platform} / ${arch}）のバージョンを取得できませんでした`);
            }
            const record = records.results.find(row => row.game_id === gameId && row.platform === platform &&
              row.arch === arch && row.version === version);
            games.push({ gameId, name, platform, arch, version, requestId: record?.request_id ?? null });
          }
        } catch {
          errors.push(`${platform} / ${arch} のカタログを取得できませんでした`);
        }
      }
    }
    games.sort((a, b) => a.gameId.localeCompare(b.gameId));
    return Response.json({ games, errors }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: "配信情報を取得できませんでした" }, { status: 503 });
  }
}
