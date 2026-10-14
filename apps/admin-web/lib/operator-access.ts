import { ensureSchema, getD1 } from "@/db/initialize";

export type GitHubIdentity = { id: number; login: string; avatar_url: string };
export type Admission = { approved_login: string; version: string; revoked_at: string | null };

/** @brief GitHubの大文字小文字を区別しないユーザー名を比較用に正規化する */
export function normalizedLogin(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(value)) {
    throw new Response("GitHubユーザー名を入力してください", { status: 400 });
  }
  return value.toLowerCase();
}

/** @brief GitHubから得た本人情報だけを数値IDとユーザー名の組として扱う */
export function verifiedIdentity(value: GitHubIdentity): GitHubIdentity {
  if (!Number.isSafeInteger(value.id) || value.id <= 0) throw new Error("Invalid GitHub identity");
  normalizedLogin(value.login);
  return { id: value.id, login: value.login, avatar_url: typeof value.avatar_url === "string" ? value.avatar_url : "" };
}

/** @brief 入力名をGitHubの本人情報へ解決し、別名へのリダイレクトは許可しない */
export async function lookupGithubUser(login: unknown): Promise<GitHubIdentity> {
  const name = normalizedLogin(typeof login === "string" ? login.trim() : login);
  const response = await fetch(`https://api.github.com/users/${encodeURIComponent(name)}`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "PandD-Deployment-Control-Plane", "x-github-api-version": "2026-03-10" },
    redirect: "manual", signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Response("GitHub本人情報を確認できません。ユーザー名を確認し、時間をおいて再試行してください", { status: response.status === 404 ? 404 : 503 });
  const user = verifiedIdentity(await response.json() as GitHubIdentity);
  if (normalizedLogin(user.login) !== name) throw new Response("GitHubユーザー名が一致しません", { status: 409 });
  return user;
}

/** @brief プロフィールのスナップショットとは独立した事前許可を取得する */
export async function admission(id: string): Promise<Admission | null> {
  await ensureSchema();
  return getD1().prepare("SELECT approved_login,version,revoked_at FROM operator_admissions WHERE github_user_id=?").bind(id).first<Admission>();
}

// 期限・取消・発行者の現在ロールと許可世代をOAuth時と受諾トランザクションで共用する
export const VALID_INVITATION = `accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?
  AND EXISTS(SELECT 1 FROM platform_roles r JOIN operator_admissions a ON a.github_user_id=r.github_user_id
    WHERE r.github_user_id=issuer AND r.role=issuer_role AND a.version=issuer_version AND a.revoked_at IS NULL
    AND (r.role='admin' OR (r.role='executive' AND operator_invitations.role='assistant' AND kind='invite')))
  AND ((kind='invite' AND role IN ('assistant','executive') AND NOT EXISTS
    (SELECT 1 FROM platform_roles WHERE github_user_id=recipient AND role IN ('admin','executive','assistant')))
    OR (kind='reapprove' AND issuer_role='admin' AND EXISTS
    (SELECT 1 FROM platform_roles WHERE github_user_id=recipient AND role=operator_invitations.role)))`;

/** @brief 招待されたGitHub本人にだけ有効な招待を返す */
export async function pendingInvitation(id: string, login: string, invitationId?: string) {
  await ensureSchema();
  return getD1().prepare(`SELECT id,role,login,expires_at FROM operator_invitations
    WHERE recipient=? AND lower(login)=? AND ${VALID_INVITATION} ${invitationId ? "AND id=?" : ""}`)
    .bind(id, normalizedLogin(login), new Date().toISOString(), ...(invitationId ? [invitationId] : []))
    .first<{ id: string; role: "assistant" | "executive" | "admin"; login: string; expires_at: string }>();
}
