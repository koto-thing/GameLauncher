import { safeReturnTo } from "./login-navigation";
import { env } from "cloudflare:workers";
import { ensureSchema, getD1 } from "@/db/initialize";
import { currentRole, permits, recordOperation, type Role } from "@/lib/roles";
import { admission, normalizedLogin, pendingInvitation, verifiedIdentity } from "@/lib/operator-access";

export type SessionUser = {
  githubUserId: string;
  admissionVersion?: string;
  invitationId?: string;
  login: string;
  avatarUrl: string;
  role: Role;
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

const SESSION_COOKIE = "pandd_deploy_session";
const STATE_COOKIE = "pandd_github_state";
const SESSION_LIFETIME_SECONDS = 6 * 60 * 60;
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

/** 認証済みユーザー情報を署名付きHttpOnlyセッションCookieへ変換する */
export async function createSessionCookie(user: SessionUser, request: Request): Promise<string> {
  const lifetime = user.invitationId ? 600 : SESSION_LIFETIME_SECONDS;
  const expiresAt = Date.now() + lifetime * 1000;
  const payload = base64UrlEncode(JSON.stringify({ user, expiresAt }));
  const value = `${payload}.${await sign(payload)}`;
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${lifetime}${secure}`;
}

/** 現在のセッションCookieを期限切れにするSet-Cookie値を作る */
export function clearSessionCookie(request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

/** リクエストCookieを検証し、期限内のセッション本人情報を返す */
async function readSignedIdentity(request: Request): Promise<SessionUser | null> {
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
    const age = Date.now() - Date.parse(decoded.user.authenticatedAt);
    if (!Number.isFinite(decoded.expiresAt) || decoded.expiresAt <= Date.now() || !Number.isFinite(age) || age < 0 ||
        age >= SESSION_LIFETIME_SECONDS * 1000 || typeof decoded.user.gameAccess !== "boolean") return null;
    if (decoded.user.authSource === "local-development" && !localDevAuthAvailable(request)) return null;
    if (decoded.user.authSource !== "github" && decoded.user.authSource !== "local-development") return null;
    if (!/^\d+$/.test(decoded.user.githubUserId)) return null;
    return decoded.user;
  } catch { return null; }
}

/** @brief 通常セッションは毎回最新の許可名・世代・ロールを検証する */
export async function readSession(request: Request): Promise<SessionUser | null> {
  try {
    const user = await readSignedIdentity(request);
    if (!user || user.invitationId) return null;
    const allowed = await admission(user.githubUserId);
    if (!allowed || allowed.revoked_at || allowed.version !== user.admissionVersion ||
        normalizedLogin(allowed.approved_login) !== normalizedLogin(user.login)) return null;
    const decoded = { user };
    decoded.user.role = await currentRole(decoded.user.githubUserId);
    if (!permits(decoded.user.role, "operate")) return null;
    decoded.user.isAdmin = decoded.user.role === "admin";
    decoded.user.gameAccess = permits(decoded.user.role, "operate");
    return decoded.user;
  } catch {
    return null;
  }
}

/** 現在の環境でローカル開発用認証を表示してよいかを判定する */
export function localDevAuthAvailable(request: Request): boolean {
  const hostname = new URL(request.url).hostname;
  return runtimeEnv().LOCAL_DEV_AUTH === "true" &&
    (hostname === "localhost" || hostname === "127.0.0.1");
}

/** GitHub OAuthに必要な公開設定が揃っているかを判定する */
export function githubAuthConfigured(): boolean {
  const current = runtimeEnv();
  return Boolean(current.GITHUB_CLIENT_ID && current.GITHUB_CLIENT_SECRET);
}

/** GitHub OAuth開始処理で利用する公開設定を返す */
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

/** ブラウザへ公開してよいGitHub OAuth Client IDを返す */
export function githubPublicClientId(): string | null {
  return runtimeEnv().GITHUB_CLIENT_ID?.trim() || null;
}

/** @brief GitHub本人確認を共通化し、リポジトリ認可失敗でもMusic本人情報を保持する。 @param accessToken GitHub App利用者トークン。 @returns サービス別のゲーム許可を含む本人情報。 */
export async function verifyGithubIdentity(accessToken: string, allowInvitation = false): Promise<SessionUser> {
  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${accessToken}`,
    "x-github-api-version": "2026-03-10",
    "user-agent": "PandD-Deployment-Control-Plane",
  };
  const userResponse = await fetch("https://api.github.com/user", { headers });
  if (!userResponse.ok) throw new Error("GitHub identity verification failed");
  const githubUser = verifiedIdentity(await userResponse.json() as GitHubUser);
  const id = String(githubUser.id);
  const allowed = await admission(id);
  // 名前変更を観測した時点で全ての既存セッションも失効させる
  if (allowed && !allowed.revoked_at && normalizedLogin(allowed.approved_login) !== normalizedLogin(githubUser.login)) {
    await getD1().prepare("UPDATE operator_admissions SET revoked_at=? WHERE github_user_id=? AND version=? AND revoked_at IS NULL")
      .bind(new Date().toISOString(),id,allowed.version).run();
    await recordOperation(null,"identity.name_changed",id,"denied");
  }
  const role = await currentRole(id);
  const invitation = !role && allowInvitation ? await pendingInvitation(id, githubUser.login) : null;
  if (!role && !invitation) {
    await recordOperation(null,"login",id,"denied");
    throw new Response("このGitHubアカウントは運営として許可されていません。ユーザー名を変更した場合は、新しい名前を運営へ連絡して再申請してください。", { status: 403 });
  }
  const isAdmin = role === "admin";
  const gameAccess = permits(role, "operate");
  const actor: SessionUser = {
    githubUserId: String(githubUser.id),
    ...(invitation ? { invitationId: invitation.id } : { admissionVersion: allowed!.version }),
    login: githubUser.login,
    avatarUrl: githubUser.avatar_url,
    role,
    isAdmin,
    gameAccess,
    authenticatedAt: new Date().toISOString(),
    authSource: "github",
  };
  if (!invitation) await upsertUser(actor);
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
  const payload = base64UrlEncode(JSON.stringify({ state, verifier, returnTo: safeReturnTo(new URL(request.url).searchParams.get("returnTo")), expiresAt: Date.now() + 600000 }));
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", githubClientConfig().clientId);
  url.searchParams.set("redirect_uri", githubCallback(request));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", base64UrlEncode(new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(verifier)))));
  url.searchParams.set("code_challenge_method", "S256");
  return { url: url.toString(), cookie: createStateCookie(`${payload}.${await sign(payload)}`, request) };
}

/** @brief state・署名・期限を検証し、PKCE verifierと同一サイトの戻り先を返す */
export async function githubFlowVerifier(request: Request, state: string): Promise<{ verifier: string; returnTo: string } | null> {
  try {
    const [payload, signature] = (consumeState(request) ?? "").split(".");
    if (!payload || !signature || !await crypto.subtle.verify("HMAC", await sessionKey(), Uint8Array.from(atob(signature.replaceAll("-", "+").replaceAll("_", "/")), character => character.charCodeAt(0)), textEncoder.encode(payload))) return null;
    const flow = JSON.parse(base64UrlDecode(payload));
    return flow.state === state && flow.expiresAt > Date.now() && typeof flow.verifier === "string" ? { verifier: flow.verifier, returnTo: safeReturnTo(flow.returnTo) } : null;
  } catch { return null; }
}

/** @brief ゲームのリポジトリ許可をサーバー入口で強制する。 @param actor 共通本人情報。 @returns ゲーム管理者。 */
export function requireGameAccess(actor: SessionUser): SessionUser {
  if (!permits(actor.role, "operate")) throw new Response("Game management permission required", { status: 403 });
  return actor;
}

/** @brief Device Flowの本人確認にも既存ゲーム条件を必須とする。 @param accessToken GitHub Appトークン。 @returns ゲーム許可済み本人。 */
export async function verifyGithubToken(accessToken: string): Promise<SessionUser> {
  return requireGameAccess(await verifyGithubIdentity(accessToken));
}

/** Intakeアップロード権限を持つ認証済み本人を取得する */
export async function requireUploaderActor(request: Request): Promise<SessionUser> {
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    if (localDevAuthAvailable(request) && token.startsWith("local-development:")) {
      const fixtureRole = token.slice("local-development:".length);
      const user = localUsers[fixtureRole];
      if (!user) throw new Response("Authentication required", { status: 401 });
      await ensureLocalFixtures();
      const role = await currentRole(user.githubUserId);
      return requireGameAccess({ ...user, role, isAdmin: role === "admin", gameAccess: permits(role, "operate"), authenticatedAt: new Date().toISOString() });
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

/** OAuth stateを改ざん防止Cookieへ保存する */
export function createStateCookie(state: string, request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${STATE_COOKIE}=${encodeURIComponent(state)}; Path=/api/auth/github; HttpOnly; SameSite=Lax; Max-Age=600${secure}`;
}

/** OAuth state Cookieを読み取り、検証後に破棄する値を返す */
export function consumeState(request: Request): string | undefined {
  return cookieValue(request, STATE_COOKIE);
}

/** OAuth state Cookieを期限切れにするSet-Cookie値を作る */
export function clearStateCookie(request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${STATE_COOKIE}=; Path=/api/auth/github; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

/** GitHub本人情報をユーザーテーブルへ追加または更新する */
export async function upsertUser(user: SessionUser): Promise<void> {
  await ensureSchema();
  await getD1()
    .prepare(`INSERT INTO users
      (github_user_id, login_snapshot, avatar_url, is_admin, last_verified_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(github_user_id) DO UPDATE SET
        login_snapshot = excluded.login_snapshot,
        avatar_url = excluded.avatar_url,
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

/** 未認証なら401を返し、認証済みセッションを取得する */
export async function requireSession(request: Request): Promise<SessionUser> {
  const user = await readSession(request);
  if (!user) throw new Response("Authentication required", { status: 401 });
  return requireGameAccess(user);
}

/** 直近に本人確認されたセッションだけを重要操作へ通す */
export async function requireRecentSession(request: Request): Promise<SessionUser> {
  return requireGameAccess(await requireRecentIdentity(request));
}

/** @brief サービス利用権限を要求せず直近の本人確認だけを検証する */
export async function requireRecentIdentity(request: Request): Promise<SessionUser> {
  const user = await readSession(request);
  if (!user) throw new Response("ログインしてください", { status: 401 });
  const age = Date.now() - Date.parse(user.authenticatedAt);
  if (!Number.isFinite(age) || age < 0 || age >= SESSION_LIFETIME_SECONDS * 1000) {
    throw new Response("GitHub re-authentication is required", { status: 403 });
  }
  return user;
}

export const localUsers: Record<string, SessionUser> = {
  admin: {
    githubUserId: "1001",
    admissionVersion: "local-1001",
    login: "koto-thing",
    avatarUrl: "",
    role: "admin",
    isAdmin: true,
    gameAccess: true,
    authenticatedAt: "",
    authSource: "local-development",
  },
  maintainer: {
    githubUserId: "1002",
    admissionVersion: "local-1002",
    login: "pandd-maintainer",
    role: "executive",
    avatarUrl: "",
    isAdmin: false,
    gameAccess: true,
    authenticatedAt: "",
    authSource: "local-development",
  },
  reviewer: {
    githubUserId: "1003",
    admissionVersion: "local-1003",
    login: "pandd-reviewer",
    role: "assistant",
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
    (login, index) => [login, { githubUserId: String(900001 + index), login, avatarUrl: "", role: null, isAdmin: false, gameAccess: false, authenticatedAt: "", authSource: "local-development" }],
  ),
);

/** ローカル開発用の固定ユーザーをD1へ登録する */
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
    ...Object.values(localUsers).map((user) => db.prepare(`INSERT INTO operator_admissions
      (github_user_id,approved_login,version) VALUES(?,?,?) ON CONFLICT DO NOTHING`)
      .bind(user.githubUserId,user.login,"local-"+user.githubUserId)),
    ...Object.values(localUsers).map((user) => db.prepare(`INSERT INTO platform_roles
      (github_user_id,role,changed_by,changed_at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING`)
      .bind(user.githubUserId,user.role,user.githubUserId,now)),
  ]);
}

/** @brief 招待本人の受諾専用Cookieは通常の運営認証として扱わない */
export async function requireInvitationIdentity(request: Request): Promise<SessionUser> {
  const user = await readSignedIdentity(request);
  if (!user?.invitationId || Date.now() - Date.parse(user.authenticatedAt) >= 600000 ||
      !await pendingInvitation(user.githubUserId,user.login,user.invitationId)) {
    throw new Response("招待が無効です。GitHubで再ログインしてください", { status: 403 });
  }
  return user;
}

/** @brief ローカル専用fixtureでも許可とロールを明示した本人にだけセッションを発行する */
export async function currentOperatorForDevelopment(template: SessionUser): Promise<SessionUser | null> {
  const allowed = await admission(template.githubUserId);
  const role = await currentRole(template.githubUserId);
  if (!allowed || allowed.revoked_at || !role) return null;
  return {...template,role,isAdmin:role === "admin",gameAccess:true,admissionVersion:allowed.version,authenticatedAt:new Date().toISOString()};
}
