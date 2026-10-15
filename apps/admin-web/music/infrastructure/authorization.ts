import { currentRole, permits } from "@/lib/roles";
import type { SessionUser } from "@/lib/auth";
import type { Principal } from "../../../music/src/domain/models";
import { MusicError } from "../../../music/src/domain/models";

/** @brief 共通本人IDをMusic専用の最新所属へ変換する。 @param db 共通D1。 @param user Cookie本人。 @returns Music権限またはnull。 */
export async function musicPrincipal(
  db: D1Database,
  user: SessionUser | null,
): Promise<Principal | null> {
  if (!user) return null;
  void db;
  const role = await currentRole(user.githubUserId);
  if (!role || !permits(role, "operate")) return null;
  return { id: user.githubUserId, login: user.login, admin: role === "admin", role, gameIds: [] };

}

/** @brief 管理操作回数をDBで原子的に制限する。 @param db 共通D1。 @param key 主体と用途。 @param maximum 1分の上限。 @returns 許可時だけ成功。 */
export async function limitMusic(
  db: D1Database,
  key: string,
  maximum: number,
): Promise<void> {
  const window = Math.floor(Date.now() / 60000);
  const row = await db
    .prepare(
      "INSERT INTO music_rate_limits(key,window,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET window=excluded.window,count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END RETURNING count",
    )
    .bind(key, window)
    .first<{ count: number }>();
  if (!row || row.count > maximum)
    throw new MusicError(
      "RATE_LIMIT",
      "操作回数の上限です。1分待って再試行してください。",
    );
}
