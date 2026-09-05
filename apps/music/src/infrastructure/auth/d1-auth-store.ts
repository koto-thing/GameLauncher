import type { AuthStore, Session } from "../../application/ports";

/** @brief セッションの有効期限と毎回の現在権限をD1から解決する。 */
export class D1AuthStore implements AuthStore {
  /** @brief サイト専用のDBを受け取る。 */
  constructor(private readonly db: D1Database) {}
  /** @brief トークンから現在のロールと所属を再取得する。 */
  async session(hash: string, now: number): Promise<Session | null> {
    const row = await this.db
      .prepare(
        "SELECT a.id,a.login,a.admin,s.csrf,s.expires_at FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?",
      )
      .bind(hash, now)
      .first<{
        id: string;
        login: string;
        admin: number;
        csrf: string;
        expires_at: number;
      }>();
    if (!row) return null;
    const memberships = await this.db
      .prepare("SELECT game_id FROM memberships WHERE account_id=?")
      .bind(row.id)
      .all<{ game_id: string }>();
    return {
      principal: {
        id: row.id,
        login: row.login,
        admin: row.admin === 1,
        gameIds: memberships.results.map(
          /** @brief 現在の作品所属を抽出する。 */ (item) => item.game_id,
        ),
      },
      csrf: row.csrf,
      expiresAt: row.expires_at,
    };
  }
  /** @brief 期限付きセッションを記録する。 */
  async createSession(
    hash: string,
    accountId: string,
    csrf: string,
    expiresAt: number,
  ): Promise<void> {
    await this.db
      .prepare("INSERT INTO sessions VALUES(?,?,?,?)")
      .bind(hash, accountId, csrf, expiresAt)
      .run();
  }
  /** @brief ログアウト後のCookie再使用を拒否する。 */
  async deleteSession(hash: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM sessions WHERE token_hash=?")
      .bind(hash)
      .run();
  }
  /** @brief 管理者許可リストを初回登録時だけ適用し、剥奪したロールを復活させない。 */
  async provisionAccount(
    id: string,
    login: string,
    admin: boolean,
  ): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO accounts(id,login,admin) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET login=excluded.login",
      )
      .bind(id, login, Number(admin))
      .run();
  }
  /** @brief PKCE verifierは短命な認証途中レコードにだけ保存する。 */
  async saveFlow(
    hash: string,
    verifier: string,
    expiresAt: number,
  ): Promise<void> {
    await this.db
      .prepare("INSERT INTO oauth_flows VALUES(?,?,?)")
      .bind(hash, verifier, expiresAt)
      .run();
  }
  /** @brief CallbackのリプレイをDELETE RETURNINGで原子的に防ぐ。 */
  async consumeFlow(hash: string, now: number): Promise<string | null> {
    return (
      (
        await this.db
          .prepare(
            "DELETE FROM oauth_flows WHERE state_hash=? AND expires_at>? RETURNING verifier",
          )
          .bind(hash, now)
          .first<{ verifier: string }>()
      )?.verifier ?? null
    );
  }
  /** @brief 複数Worker間で共有する回数制限を原子的に加算する。 */
  async rateLimit(key: string, window: number, max: number): Promise<boolean> {
    const result = await this.db
      .prepare(
        "INSERT INTO rate_limits(key,window,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END,window=excluded.window RETURNING count",
      )
      .bind(key, window)
      .first<{ count: number }>();
    return result!.count <= max;
  }
}
