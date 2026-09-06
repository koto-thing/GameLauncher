import { env } from "cloudflare:workers";
import { ensureSchema, getD1 } from "@/db/initialize";

export type SessionUser = {
  githubUserId: string;
  login: string;
  avatarUrl: string;
  isAdmin: boolean;
  gameAccess: boolean;
  authenticatedAt: string;
  authSource: "github" | "local-development";
};

type RuntimeEnv = {
  SESSION_SECRET?: string;
  LOCAL_DEV_AUTH?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GITHUB_CALLBACK_URL?: string;
};

type GitHubUser = { id: number; login: string; avatar_url: string };
type GitHubRepository = { owner: { id: number } };
type GitHubPermission = { permission: string; role_name: string };

const SESSION_COOKIE = "pandd_deploy_session";
const STATE_COOKIE = "pandd_github_state";
const textEncoder = new TextEncoder();

function runtimeEnv(): RuntimeEnv {
  return env as unknown as RuntimeEnv;
}

function cookieValue(request: Request, name: string): string | undefined {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) { try { return decodeURIComponent(value.join("=")); } catch { return undefined; } }
  }
  return undefined;
}

function base64UrlEncode(value: Uint8Array | string): string {
  const bytes = typeof value === "string" ? textEncoder.encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): string {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

async function sessionKey(): Promise<CryptoKey> {
  const secret = runtimeEnv().SESSION_SECRET;
  if (!secret || secret.length < 24) {
    throw new Error("SESSION_SECRET must contain at least 24 characters");
  }
  return crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function sign(payload: string): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", await sessionKey(), textEncoder.encode(payload));
  return base64UrlEncode(new Uint8Array(signature));
}

export async function createSessionCookie(user: SessionUser, request: Request): Promise<string> {
  const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
  const payload = base64UrlEncode(JSON.stringify({ user, expiresAt }));
  const value = `${payload}.${await sign(payload)}`;
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${secure}`;
}

export function clearSessionCookie(request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export async function readSession(request: Request): Promise<SessionUser | null> {
  const value = cookieValue(request, SESSION_COOKIE);
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = await sign(payload);
  if (expected.length !== signature.length) return null;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  }
  if (mismatch !== 0) return null;
  try {
    const decoded = JSON.parse(base64UrlDecode(payload)) as {
      user: SessionUser;
      expiresAt: number;
    };
    // 古いCookieにゲーム許可を補完せず、サービス境界導入後は再ログインする。
    if (decoded.expiresAt <= Date.now() || typeof decoded.user.gameAccess !== "boolean") return null;
    if (decoded.user.authSource === "local-development" && !localDevAuthAvailable(request)) return null;
    return decoded.user;
  } catch {
    return null;
  }
}

export function localDevAuthAvailable(request: Request): boolean {
  const hostname = new URL(request.url).hostname;
  return runtimeEnv().LOCAL_DEV_AUTH === "true" &&
    (hostname === "localhost" || hostname === "127.0.0.1");
}

export function githubAuthConfigured(): boolean {
  const current = runtimeEnv();
  return Boolean(current.GITHUB_CLIENT_ID && current.GITHUB_CLIENT_SECRET);
}

export function githubClientConfig() {
  const current = runtimeEnv();
  if (!current.GITHUB_CLIENT_ID || !current.GITHUB_CLIENT_SECRET) {
    throw new Error("GitHub App OAuth is not configured");
  }
  return {
    clientId: current.GITHUB_CLIENT_ID,
    clientSecret: current.GITHUB_CLIENT_SECRET,
  };
}

export function githubPublicClientId(): string | null {
  return runtimeEnv().GITHUB_CLIENT_ID?.trim() || null;
}

/** @brief GitHub本人確認を共通化し、リポジトリ認可失敗でもMusic本人情報を保持する。 @param accessToken GitHub App利用者トークン。 @returns サービス別のゲーム許可を含む本人情報。 */
export async function verifyGithubIdentity(accessToken: string): Promise<SessionUser> {
  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${accessToken}`,
    "x-github-api-version": "2026-03-10",
    "user-agent": "PandD-Deployment-Control-Plane",
  };
  const userResponse = await fetch("https://api.github.com/user", { headers });
  if (!userResponse.ok) throw new Error("GitHub identity verification failed");
  const githubUser = await userResponse.json() as GitHubUser;
  if (!Number.isSafeInteger(githubUser.id) || githubUser.id <= 0) throw new Error("Invalid GitHub identity");
  let isAdmin: boolean;
  let gameAccess: boolean;
  try {
    const repositoryResponse = await fetch("https://api.github.com/repos/koto-thing/GameLauncher", { headers });
    if (!repositoryResponse.ok) throw new Error("Repository unavailable");
    const repository = await repositoryResponse.json() as GitHubRepository;
    isAdmin = githubUser.id === repository.owner.id;
    gameAccess = isAdmin;
    if (!isAdmin) {
    const permissionResponse = await fetch(
      `https://api.github.com/repos/koto-thing/GameLauncher/collaborators/${encodeURIComponent(githubUser.login)}/permission`,
      { headers },
    );
    if (!permissionResponse.ok) throw new Error("Repository Collaboratorではありません");
    const permission = await permissionResponse.json() as GitHubPermission;
      gameAccess = permission.permission === "write" || permission.permission === "admin" || permission.role_name === "maintain";
    }
  } catch {
    // リポジトリへのアクセス不足・障害時にはゲーム管理を閉じる。
    isAdmin = false;
    gameAccess = false;
  }
  const actor: SessionUser = {
    githubUserId: String(githubUser.id),
    login: githubUser.login,
    avatarUrl: githubUser.avatar_url,
    isAdmin,
    gameAccess,
    authenticatedAt: new Date().toISOString(),
    authSource: "github",
  };
  if (gameAccess) await upsertUser(actor);
  return actor;
}

/** @brief OAuthの固定Callbackを設定から解決する。 @param request 正規ログイン要求。 @returns 検証済みCallback。 */
export function githubCallback(request: Request): string {
  const configured = runtimeEnv().GITHUB_CALLBACK_URL;
  const url = new URL(configured || (localDevAuthAvailable(request) ? "/api/auth/github/callback" : ""), request.url);
  if ((!configured && !localDevAuthAvailable(request)) || url.origin !== new URL(request.url).origin ||
      url.pathname !== "/api/auth/github/callback" || url.search || url.hash) throw new Error("GITHUB_CALLBACK_URL is not configured for this origin");
  return url.toString();
}

/** @brief PKCE S256と改ざん不可の短期stateを作る。 @param request ログイン開始要求。 @returns 認可URLとCookie。 */
export async function beginGithubFlow(request: Request): Promise<{ url: string; cookie: string }> {
  const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const state = crypto.randomUUID();
  const payload = base64UrlEncode(JSON.stringify({ state, verifier, expiresAt: Date.now() + 600000 }));
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", githubClientConfig().clientId);
  url.searchParams.set("redirect_uri", githubCallback(request));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", base64UrlEncode(new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(verifier)))));
  url.searchParams.set("code_challenge_method", "S256");
  return { url: url.toString(), cookie: createStateCookie(`${payload}.${await sign(payload)}`, request) };
}

/** @brief state・署名・期限を検証し交換用verifierを返す。 @param request Callback要求。 @param state GitHubが返したstate。 @returns 短期PKCE verifier。 */
export async function githubFlowVerifier(request: Request, state: string): Promise<string | null> {
  try {
    const [payload, signature] = (consumeState(request) ?? "").split(".");
    if (!payload || !signature || !await crypto.subtle.verify("HMAC", await sessionKey(), Uint8Array.from(atob(signature.replaceAll("-", "+").replaceAll("_", "/")), character => character.charCodeAt(0)), textEncoder.encode(payload))) return null;
    const flow = JSON.parse(base64UrlDecode(payload));
    return flow.state === state && flow.expiresAt > Date.now() ? flow.verifier : null;
  } catch { return null; }
}

/** @brief ゲームのリポジトリ許可をサーバー入口で強制する。 @param actor 共通本人情報。 @returns ゲーム管理者。 */
export function requireGameAccess(actor: SessionUser): SessionUser {
  if (actor.gameAccess !== true) throw new Response("Game management permission required", { status: 403 });
  return actor;
}

/** @brief Device Flowの本人確認にも既存ゲーム条件を必須とする。 @param accessToken GitHub Appトークン。 @returns ゲーム許可済み本人。 */
export async function verifyGithubToken(accessToken: string): Promise<SessionUser> {
  return requireGameAccess(await verifyGithubIdentity(accessToken));
}

export async function requireUploaderActor(request: Request): Promise<SessionUser> {
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    if (localDevAuthAvailable(request) && token.startsWith("local-development:")) {
      const role = token.slice("local-development:".length);
      const user = localUsers[role];
      if (!user) throw new Response("Authentication required", { status: 401 });
      await ensureLocalFixtures();
      return { ...user, authenticatedAt: new Date().toISOString() };
    }
    try {
      return await verifyGithubToken(token);
    } catch {
      throw new Response("GitHub identity verification failed", { status: 403 });
    }
  }

  const session = await readSession(request);
  if (session) {
    return requireGameAccess(session);
  }

  throw new Response("Authentication required", { status: 401 });
}

export function createStateCookie(state: string, request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${STATE_COOKIE}=${encodeURIComponent(state)}; Path=/api/auth/github; HttpOnly; SameSite=Lax; Max-Age=600${secure}`;
}

export function consumeState(request: Request): string | undefined {
  return cookieValue(request, STATE_COOKIE);
}

export function clearStateCookie(request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${STATE_COOKIE}=; Path=/api/auth/github; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export async function upsertUser(user: SessionUser): Promise<void> {
  await ensureSchema();
  await getD1()
    .prepare(`INSERT INTO users
      (github_user_id, login_snapshot, avatar_url, is_admin, last_verified_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(github_user_id) DO UPDATE SET
        login_snapshot = excluded.login_snapshot,
        avatar_url = excluded.avatar_url,
        is_admin = excluded.is_admin,
        last_verified_at = excluded.last_verified_at`)
    .bind(
      user.githubUserId,
      user.login,
      user.avatarUrl,
      user.isAdmin ? 1 : 0,
      new Date().toISOString(),
    )
    .run();
}

export async function requireSession(request: Request): Promise<SessionUser> {
  const user = await readSession(request);
  if (!user) throw new Response("Authentication required", { status: 401 });
  return requireGameAccess(user);
}

export async function requireRecentSession(request: Request): Promise<SessionUser> {
  const user = await requireSession(request);
  const age = Date.now() - Date.parse(user.authenticatedAt);
  if (!Number.isFinite(age) || age > 15 * 60 * 1000) {
    throw new Response("GitHub re-authentication is required", { status: 403 });
  }
  return user;
}

export const localUsers: Record<string, SessionUser> = {
  admin: {
    githubUserId: "1001",
    login: "koto-thing",
    avatarUrl: "",
    isAdmin: true,
    gameAccess: true,
    authenticatedAt: "",
    authSource: "local-development",
  },
  maintainer: {
    githubUserId: "1002",
    login: "pandd-maintainer",
    avatarUrl: "",
    isAdmin: false,
    gameAccess: true,
    authenticatedAt: "",
    authSource: "local-development",
  },
  reviewer: {
    githubUserId: "1003",
    login: "pandd-reviewer",
    avatarUrl: "",
    isAdmin: false,
    gameAccess: true,
    authenticatedAt: "",
    authSource: "local-development",
  },
};

// ローカル専用の本人情報。MusicのDB割り当ては隔離環境のseedで明示登録する。
export const musicLocalUsers: Record<string, SessionUser> = Object.fromEntries(
  ["music-admin", "music-a", "music-b", "outsider"].map(
    /** @brief ゲーム権限を持たない固定fixtureを定義する。 @param login 表示名。 @param index 固定IDの位置。 @returns 本人情報。 */
    (login, index) => [login, { githubUserId: String(900001 + index), login, avatarUrl: "", isAdmin: false, gameAccess: false, authenticatedAt: "", authSource: "local-development" }],
  ),
);

export async function ensureLocalFixtures(): Promise<void> {
  await ensureSchema();
  const now = new Date().toISOString();
  const db = getD1();
  await db.batch([
    ...Object.values(localUsers).map((user) =>
      db.prepare(`INSERT INTO users
        (github_user_id, login_snapshot, avatar_url, is_admin, last_verified_at)
        VALUES (?, ?, '', ?, ?)
        ON CONFLICT(github_user_id) DO UPDATE SET login_snapshot = excluded.login_snapshot,
          is_admin = excluded.is_admin, last_verified_at = excluded.last_verified_at`)
        .bind(user.githubUserId, user.login, user.isAdmin ? 1 : 0, now),
    ),
    db.prepare(`INSERT INTO policy_grants
      (github_user_id, grant_type, granted_by_github_user_id, granted_at, revoked_at)
      VALUES ('1002', 'requester', '1001', ?, NULL)
      ON CONFLICT(github_user_id, grant_type) DO UPDATE SET revoked_at = NULL`)
      .bind(now),
    db.prepare(`INSERT INTO policy_grants
      (github_user_id, grant_type, granted_by_github_user_id, granted_at, revoked_at)
      VALUES ('1003', 'approver', '1001', ?, NULL)
      ON CONFLICT(github_user_id, grant_type) DO UPDATE SET revoked_at = NULL`)
      .bind(now),
  ]);
}
