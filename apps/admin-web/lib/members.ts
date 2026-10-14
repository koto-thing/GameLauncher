import { ensureSchema, getD1 } from "@/db/initialize";
import type { SessionUser } from "@/lib/auth";
import { currentRole, normalizeRole, requirePermission } from "@/lib/roles";

/** @brief 登録済みのGitHub数値IDだけを招待・役割変更の対象にする */
function userId(value: unknown): string {
  if (typeof value !== "string" || !/^\d{1,20}$/.test(value)) throw new Response("GitHub user ID is required", { status: 400 });
  return value;
}

/** @brief 権限書き込みと同じトランザクション内で結果を残す */
function event(actor: SessionUser, action: string, target: string) {
  return getD1().prepare(`INSERT INTO operation_events(id,actor,action,target,result,at)
    SELECT ?,?,?,?,'succeeded',? WHERE changes()=1`)
    .bind(crypto.randomUUID(), actor.githubUserId, action, target, new Date().toISOString());
}

/** @brief 本人宛の招待と運営ロール管理用の一覧を返す */
export async function memberDashboard(actor: SessionUser) {
  const role = await currentRole(actor.githubUserId);
  const canInvite = role === "admin" || role === "executive";
  const db = getD1();
  const invitations = await db.prepare(`SELECT id,role,issuer,expires_at FROM member_invitations
    WHERE recipient=? AND accepted_at IS NULL AND expires_at>?`).bind(actor.githubUserId, new Date().toISOString()).all();
  const users = canInvite ? (await db.prepare(`SELECT u.github_user_id AS id,u.login_snapshot AS login,
    COALESCE(r.role,'user') AS role FROM users u LEFT JOIN platform_roles r ON r.github_user_id=u.github_user_id
    ORDER BY u.login_snapshot`).all()).results : [];
  return { role, users, invitations: invitations.results };
}

/** @brief 幹部の招待は補佐だけに制限し、既存メンバーの役割変更を拒否する */
export async function inviteMember(actor: SessionUser, input: Record<string, unknown>) {
  const role = await requirePermission(actor, "invite");
  const recipient = userId(input.githubUserId);
  if (input.role !== "assistant" && input.role !== "executive") throw new Response("Invalid invitation role", { status: 400 });
  if (role !== "admin" && input.role !== "assistant") throw new Response("Only Admin can invite executives", { status: 403 });
  const id = crypto.randomUUID();
  const expires = new Date(Date.now() + 7 * 86400000).toISOString();
  const db = getD1();
  const results = await db.batch([
    db.prepare(`INSERT INTO member_invitations(id,recipient,role,issuer,expires_at)
      SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE github_user_id=?)
      AND NOT EXISTS(SELECT 1 FROM platform_roles WHERE github_user_id=? AND role!='user')
      AND EXISTS(SELECT 1 FROM platform_roles WHERE github_user_id=? AND (role='admin' OR (role='executive' AND ?='assistant')))`)
      .bind(id,recipient,input.role,actor.githubUserId,expires,recipient,recipient,actor.githubUserId,input.role),
    event(actor,"member.invited",`${recipient}:${input.role}`),
  ]);
  if (!results[0].meta.changes) throw new Response("Target must be a registered general user; refresh permissions", { status: 409 });
  return { id, expiresAt: expires };
}

/** @brief 招待のロールはDBだけから取得し、発行者の最新権限も原子的に検証する */
export async function acceptInvitation(actor: SessionUser, input: Record<string, unknown>) {
  await ensureSchema();
  if (typeof input.id !== "string" || input.role !== undefined || input.githubUserId !== undefined) throw new Response("Invalid invitation acceptance", { status: 400 });
  const db = getD1();
  const timestamp = new Date().toISOString();
  const results = await db.batch([
    db.prepare(`UPDATE member_invitations SET accepted_at=? WHERE id=? AND recipient=? AND accepted_at IS NULL AND expires_at>?
      AND role IN ('assistant','executive')
      AND NOT EXISTS(SELECT 1 FROM platform_roles WHERE github_user_id=? AND role!='user')
      AND EXISTS(SELECT 1 FROM platform_roles r WHERE r.github_user_id=issuer AND (r.role='admin' OR (r.role='executive' AND member_invitations.role='assistant')))`)
      .bind(timestamp,input.id,actor.githubUserId,timestamp,actor.githubUserId),
    db.prepare(`INSERT INTO platform_roles(github_user_id,role,changed_by,changed_at)
      SELECT recipient,role,issuer,accepted_at FROM member_invitations WHERE id=? AND changes()=1
      ON CONFLICT(github_user_id) DO UPDATE SET role=excluded.role,changed_by=excluded.changed_by,changed_at=excluded.changed_at`)
      .bind(input.id),
    event(actor,"invitation.accepted",input.id),
  ]);
  if (!results[0].meta.changes) throw new Response("Invitation is unavailable", { status: 409 });
}

/** @brief Adminだけが役割を変更でき、最後のAdminの降格を防止する */
export async function changeRole(actor: SessionUser, input: Record<string, unknown>) {
  await requirePermission(actor, "roles");
  const target = userId(input.githubUserId);
  if (normalizeRole(input.role) !== input.role) throw new Response("Invalid role", { status: 400 });
  const db = getD1();
  const results = await db.batch([
    db.prepare(`INSERT INTO platform_roles(github_user_id,role,changed_by,changed_at)
      SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE github_user_id=?)
      AND EXISTS(SELECT 1 FROM platform_roles WHERE github_user_id=? AND role='admin')
      AND (?='admin' OR NOT EXISTS(SELECT 1 FROM platform_roles WHERE github_user_id=? AND role='admin')
        OR (SELECT COUNT(*) FROM platform_roles WHERE role='admin')>1)
      ON CONFLICT(github_user_id) DO UPDATE SET role=excluded.role,changed_by=excluded.changed_by,changed_at=excluded.changed_at`)
      .bind(target,input.role,actor.githubUserId,new Date().toISOString(),target,actor.githubUserId,input.role,target),
    event(actor,"role.changed",`${target}:${input.role}`),
  ]);
  if (!results[0].meta.changes) throw new Response("Role change rejected; keep at least one Admin", { status: 409 });
}
