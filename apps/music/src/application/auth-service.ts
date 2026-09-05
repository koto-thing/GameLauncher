import type { AuthStore, Clock, IdentityProvider, Session } from "./ports";
import { MusicError } from "../domain/models";

export interface AuthPolicy {
  origin: string;
  githubClientId: string;
  configured: boolean;
  bootstrapAdminIds: string[];
  sessionSeconds: number;
  flowSeconds: number;
}
export interface TokenPort {
  random(): string;
  hash(value: string): Promise<string>;
  equal(left: string, right: string): boolean;
}

/** @brief OAuthとセッションのユースケース。CookieやSQLの詳細に依存しない。 */
export class AuthService {
  /** @brief 認証境界と時刻・トークン生成を注入する。 */
  constructor(
    readonly store: AuthStore,
    private readonly provider: IdentityProvider,
    private readonly tokens: TokenPort,
    private readonly clock: Clock,
    private readonly policy: AuthPolicy,
  ) {}
  /** @brief 短命stateとS256 challengeを作り、固定callbackを使う。 */
  async begin(): Promise<{ state: string; url: string }> {
    if (!this.policy.configured)
      throw new MusicError("UNAVAILABLE", "GitHub OAuthの設定待ちです。");
    const state = this.tokens.random();
    const verifier = this.tokens.random();
    await this.store.saveFlow(
      await this.tokens.hash(state),
      verifier,
      this.clock.now() + this.policy.flowSeconds * 1000,
    );
    const params = new URLSearchParams({
      client_id: this.policy.githubClientId,
      redirect_uri: `${this.policy.origin}/api/auth/callback`,
      scope: "",
      state,
      code_challenge: await this.tokens.hash(verifier),
      code_challenge_method: "S256",
      allow_signup: "false",
    });
    return { state, url: `https://github.com/login/oauth/authorize?${params}` };
  }
  /** @brief state照合・一度きりの交換・サイトアカウント作成を順番に実行する。 */
  async complete(
    code: string,
    state: string,
    cookieState: string,
  ): Promise<{ token: string; csrf: string }> {
    if (
      !code ||
      !state ||
      !cookieState ||
      !this.tokens.equal(state, cookieState)
    )
      throw new MusicError(
        "UNAUTHENTICATED",
        "認証状態が一致しません。ログインからやり直してください。",
      );
    const verifier = await this.store.consumeFlow(
      await this.tokens.hash(state),
      this.clock.now(),
    );
    if (!verifier)
      throw new MusicError(
        "UNAUTHENTICATED",
        "認証が期限切れか、すでに使用されています。",
      );
    const identity = await this.provider.exchange(code, verifier);
    await this.store.provisionAccount(
      identity.id,
      identity.login,
      this.policy.bootstrapAdminIds.includes(identity.id),
    );
    return this.issue(identity.id);
  }
  /** @brief 認証済みアカウントに期限付きセッションを発行する。 @remarks HTTP入力から直接呼ばない。 */
  async issue(accountId: string): Promise<{ token: string; csrf: string }> {
    const token = this.tokens.random();
    const csrf = this.tokens.random();
    await this.store.createSession(
      await this.tokens.hash(token),
      accountId,
      csrf,
      this.clock.now() + this.policy.sessionSeconds * 1000,
    );
    return { token, csrf };
  }
  /** @brief 期限と最新所属を確認する。 */
  async session(token: string): Promise<Session | null> {
    return token
      ? this.store.session(await this.tokens.hash(token), this.clock.now())
      : null;
  }
  /** @brief DB側でもセッションを無効化する。 */
  async logout(token: string): Promise<void> {
    if (token) await this.store.deleteSession(await this.tokens.hash(token));
  }
  /** @brief 全更新リクエストでOriginとCSRFを確認する。 */
  csrf(session: Session | null, origin: string, token: string): void {
    if (!session)
      throw new MusicError("UNAUTHENTICATED", "ログインしてください。");
    if (
      origin !== this.policy.origin ||
      !token ||
      !this.tokens.equal(token, session.csrf)
    )
      throw new MusicError(
        "FORBIDDEN",
        "送信元を確認できません。ページを再読込してください。",
      );
  }
  /** @brief 認証とアップロードの過剰な操作を抑える。 */
  async limit(key: string, max: number): Promise<void> {
    if (
      !(await this.store.rateLimit(
        key,
        Math.floor(this.clock.now() / 60_000),
        max,
      ))
    )
      throw new MusicError(
        "RATE_LIMIT",
        "操作が多すぎます。1分後に再試行してください。",
      );
  }
}
