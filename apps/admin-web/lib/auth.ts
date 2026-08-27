import { env } from "cloudflare:workers";
import { ensureSchema, getD1 } from "@/db/initialize";

export type SessionUser = {
  githubUserId: string;
  login: string;
  avatarUrl: string;
  isAdmin: boolean;
  authenticatedAt: string;
  authSource: "github" | "local-development";
};

type RuntimeEnv = {
  SESSION_SECRET?: string;
  LOCAL_DEV_AUTH?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
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
    if (key === name) return decodeURIComponent(value.join("="));
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
    if (decoded.expiresAt <= Date.now()) return null;
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

export async function verifyGithubToken(accessToken: string): Promise<SessionUser> {
  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${accessToken}`,
    "x-github-api-version": "2026-03-10",
    "user-agent": "PandD-Deployment-Control-Plane",
  };
  const [userResponse, repositoryResponse] = await Promise.all([
    fetch("https://api.github.com/user", { headers }),
    fetch("https://api.github.com/repos/koto-thing/GameLauncher", { headers }),
  ]);
  if (!userResponse.ok || !repositoryResponse.ok) throw new Error("GitHub identity verification failed");
  const githubUser = await userResponse.json() as GitHubUser;
  const repository = await repositoryResponse.json() as GitHubRepository;
  const isAdmin = githubUser.id === repository.owner.id;
  if (!isAdmin) {
    const permissionResponse = await fetch(
      `https://api.github.com/repos/koto-thing/GameLauncher/collaborators/${encodeURIComponent(githubUser.login)}/permission`,
      { headers },
    );
    if (!permissionResponse.ok) throw new Error("Repository Collaboratorではありません");
    const permission = await permissionResponse.json() as GitHubPermission;
    if (!(permission.permission === "write" || permission.permission === "admin" ||
        permission.role_name === "maintain")) {
      throw new Error("Repository Collaboratorではありません");
    }
  }
  const actor: SessionUser = {
    githubUserId: String(githubUser.id),
    login: githubUser.login,
    avatarUrl: githubUser.avatar_url,
    isAdmin,
    authenticatedAt: new Date().toISOString(),
    authSource: "github",
  };
  await upsertUser(actor);
  return actor;
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
    return session;
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
  return user;
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
    authenticatedAt: "",
    authSource: "local-development",
  },
  maintainer: {
    githubUserId: "1002",
    login: "pandd-maintainer",
    avatarUrl: "",
    isAdmin: false,
    authenticatedAt: "",
    authSource: "local-development",
  },
  reviewer: {
    githubUserId: "1003",
    login: "pandd-reviewer",
    avatarUrl: "",
    isAdmin: false,
    authenticatedAt: "",
    authSource: "local-development",
  },
};

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
