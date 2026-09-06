import type { SessionUser } from "@/lib/auth";
import type { Principal } from "../../../music/src/domain/models";
import { MusicError } from "../../../music/src/domain/models";

/** @brief 共通本人IDをMusic専用の最新所属へ変換する。 @param db 共通D1。 @param user Cookie本人。 @returns Music権限またはnull。 */
export async function musicPrincipal(
  db: D1Database,
  user: SessionUser | null,
): Promise<Principal | null> {
  if (!user) return null;
  const account = await db
    .prepare("SELECT id,admin FROM music_accounts WHERE id=?")
    .bind(user.githubUserId)
    .first<{ id: string; admin: number }>();
  if (!account) return null;
  const memberships = (
    await db
      .prepare("SELECT game_id FROM music_memberships WHERE account_id=?")
      .bind(account.id)
      .all<{ game_id: string }>()
  ).results;
  if (!account.admin && memberships.length === 0) return null;
  return {
    id: account.id,
    login: user.login,
    admin: account.admin === 1,
    gameIds: memberships.map(
      /** @brief 所属IDだけを取り出す。 */ (row) => row.game_id,
    ),
  };
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
