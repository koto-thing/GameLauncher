import { ensureSchema, getD1 } from "@/db/initialize";
import type { SessionUser } from "@/lib/auth";
import { currentRole, normalizeRole, requirePermission } from "@/lib/roles";
import { admission, lookupGithubUser, normalizedLogin, VALID_INVITATION } from "@/lib/operator-access";

/** @brief 直前の単一更新が成功した場合だけ同じトランザクションに監査を残す */
function event(actor: SessionUser, action: string, target: string) {
  return getD1().prepare(`INSERT INTO operation_events(id,actor,action,target,result,at)
    SELECT ?,?,?,?,'succeeded',? WHERE changes()=1`)
    .bind(crypto.randomUUID(),actor.githubUserId,action,target,new Date().toISOString());
}

/** @brief 運営一覧と発行済み招待を現在の権限に応じて返す */
export async function memberDashboard(actor: SessionUser) {
  const role = await requirePermission(actor,"operate");
  const canInvite = role === "admin" || role === "executive";
  const db = getD1();
  const users = canInvite ? (await db.prepare(`SELECT u.github_user_id AS id,u.login_snapshot AS login,
    CASE WHEN a.revoked_at IS NULL AND r.role IN ('admin','executive','assistant') THEN r.role ELSE NULL END AS role,
    a.approved_login AS approvedLogin FROM users u JOIN operator_admissions a ON a.github_user_id=u.github_user_id
    LEFT JOIN platform_roles r ON r.github_user_id=u.github_user_id ORDER BY u.login_snapshot`).all()).results : [];
  const invitations = canInvite ? (await db.prepare(`SELECT id,login,role,expires_at,kind FROM operator_invitations
    WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at>? AND (?='admin' OR issuer=?) ORDER BY expires_at`)
    .bind(new Date().toISOString(),role,actor.githubUserId).all()).results : [];
  return { role, users, invitations };
}

/** @brief 入力名をGitHubで再確認し未登録本人にも期限付き招待を発行する */
export async function inviteMember(actor: SessionUser, input: Record<string, unknown>) {
  const issuerRole = await requirePermission(actor,"invite");
  if (input.githubUserId !== undefined || input.id !== undefined) throw new Response("ユーザー名だけで指定してください",{status:400});
  const kind = input.action === "reapprove" ? "reapprove" : "invite";
  if (kind === "reapprove" && issuerRole !== "admin") throw new Response("Only Admin can reapprove names",{status:403});
  if (kind === "invite" && input.role !== "assistant" && input.role !== "executive") throw new Response("Invalid invitation role",{status:400});
  if (kind === "invite" && issuerRole !== "admin" && input.role !== "assistant") throw new Response("Only Admin can invite executives",{status:403});
  const identity = await lookupGithubUser(input.login);
  if (input.confirmedId !== String(identity.id)) throw new Response("本人情報をもう一度確認してください",{status:409});
  const recipient = String(identity.id);
  const db = getD1();
  const previous = await db.prepare("SELECT role FROM platform_roles WHERE github_user_id=?").bind(recipient).first<{role:string}>();
  const targetRole = kind === "reapprove" ? normalizeRole(previous?.role) : input.role as string;
  if (!targetRole) throw new Response("再承認する運営メンバーがいません",{status:409});
  const allowed = await admission(actor.githubUserId);
  if (!allowed || allowed.revoked_at) throw new Response("Permission changed",{status:403});
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const expires = new Date(Date.now()+7*86400000).toISOString();
  const results = await db.batch([
    db.prepare("UPDATE operator_invitations SET revoked_at=? WHERE recipient=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at<=?").bind(now,recipient,now),
    db.prepare(`INSERT INTO operator_invitations(id,recipient,login,avatar_url,role,issuer,issuer_role,issuer_version,kind,expires_at)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE
      EXISTS(SELECT 1 FROM platform_roles r JOIN operator_admissions a ON a.github_user_id=r.github_user_id
        WHERE r.github_user_id=? AND r.role=? AND a.version=? AND a.revoked_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM operator_invitations WHERE recipient=? AND accepted_at IS NULL AND revoked_at IS NULL)
      AND ((?='invite' AND NOT EXISTS(SELECT 1 FROM platform_roles WHERE github_user_id=? AND role IN ('admin','executive','assistant')))
        OR (?='reapprove' AND EXISTS(SELECT 1 FROM platform_roles WHERE github_user_id=? AND role=?)))`)
      .bind(id,recipient,identity.login,identity.avatar_url,targetRole,actor.githubUserId,issuerRole,allowed.version,kind,expires,
        actor.githubUserId,issuerRole,allowed.version,recipient,kind,recipient,kind,recipient,targetRole),
    event(actor,kind === "reapprove" ? "member.name_reapproval_invited" : "member.invited",`${recipient}:${identity.login}:${targetRole}`),
  ]);
  if (!results[1].meta.changes) throw new Response("既存メンバーまたは招待と重複しています。最新の権限を確認してください",{status:409});
  return {id,expiresAt:expires};
}

/** @brief 本人・許可名・期限・取消・発行者を原子的に確認し本人レコードと権限を作る */
export async function acceptInvitation(actor: SessionUser, input: Record<string, unknown>) {
  await ensureSchema();
  if (typeof input.id !== "string" || actor.invitationId !== input.id || input.role !== undefined || input.githubUserId !== undefined || input.login !== undefined) {
    throw new Response("Invalid invitation acceptance",{status:400});
  }
  const db = getD1();
  const now = new Date().toISOString();
  const token = crypto.randomUUID();
  const results = await db.batch([
    db.prepare(`UPDATE operator_invitations SET accepted_at=?,accepted_token=? WHERE id=? AND recipient=? AND lower(login)=? AND ${VALID_INVITATION}`)
      .bind(now,token,input.id,actor.githubUserId,normalizedLogin(actor.login),now),
    db.prepare(`INSERT INTO users(github_user_id,login_snapshot,avatar_url,is_admin,last_verified_at)
      SELECT recipient,login,?,0,? FROM operator_invitations WHERE accepted_token=?
      ON CONFLICT(github_user_id) DO UPDATE SET login_snapshot=excluded.login_snapshot,avatar_url=excluded.avatar_url,last_verified_at=excluded.last_verified_at`)
      .bind(actor.avatarUrl,now,token),
    db.prepare(`INSERT INTO platform_roles(github_user_id,role,changed_by,changed_at)
      SELECT recipient,role,issuer,accepted_at FROM operator_invitations WHERE accepted_token=?
      ON CONFLICT(github_user_id) DO UPDATE SET role=excluded.role,changed_by=excluded.changed_by,changed_at=excluded.changed_at`).bind(token),
    db.prepare(`INSERT INTO operator_admissions(github_user_id,approved_login,version,revoked_at)
      SELECT recipient,login,accepted_token,NULL FROM operator_invitations WHERE accepted_token=?
      ON CONFLICT(github_user_id) DO UPDATE SET approved_login=excluded.approved_login,version=excluded.version,revoked_at=NULL`).bind(token),
    // Musicのadminフラグは認可に使わず外部キーの本人参照だけを整合させる
    db.prepare(`INSERT INTO music_accounts(id,login,admin) SELECT recipient,login,0 FROM operator_invitations WHERE accepted_token=?
      ON CONFLICT(id) DO UPDATE SET login=excluded.login`).bind(token),
    event(actor,"invitation.accepted",input.id),
  ]);
  if (!results[0].meta.changes) throw new Response("Invitation is unavailable",{status:409});
  const role = await currentRole(actor.githubUserId);
  return {...actor,invitationId:undefined,admissionVersion:token,role,isAdmin:role === "admin",gameAccess:true};
}

/** @brief Adminまたは発行者本人が未受諾招待を取り消す */
export async function revokeInvitation(actor: SessionUser, input: Record<string, unknown>) {
  await requirePermission(actor,"invite");
  if (typeof input.id !== "string") throw new Response("Invalid invitation",{status:400});
  const db = getD1();
  const result = await db.batch([
    db.prepare(`UPDATE operator_invitations SET revoked_at=? WHERE id=? AND accepted_at IS NULL AND revoked_at IS NULL
      AND EXISTS(SELECT 1 FROM platform_roles r JOIN operator_admissions a ON a.github_user_id=r.github_user_id
        WHERE r.github_user_id=? AND a.revoked_at IS NULL AND (r.role='admin' OR (r.role='executive' AND issuer=?)))`)
      .bind(new Date().toISOString(),input.id,actor.githubUserId,actor.githubUserId),
    event(actor,"invitation.revoked",input.id),
  ]);
  if (!result[0].meta.changes) throw new Response("Invitation is unavailable",{status:409});
}

/** @brief Adminだけが運営ロールを変更し取消と最後の有効Adminを保護する */
export async function changeRole(actor: SessionUser, input: Record<string, unknown>) {
  await requirePermission(actor,"roles");
  const target = input.githubUserId;
  if (typeof target !== "string" || !/^\d{1,20}$/.test(target) || normalizeRole(input.role) !== input.role) throw new Response("Invalid role change",{status:400});
  const db = getD1();
  const now = new Date().toISOString();
  const result = await db.batch([
    db.prepare(`UPDATE platform_roles SET role=?,changed_by=?,changed_at=? WHERE github_user_id=?
      AND role IN ('admin','executive','assistant')
      AND EXISTS(SELECT 1 FROM operator_admissions WHERE github_user_id=? AND revoked_at IS NULL)
      AND EXISTS(SELECT 1 FROM platform_roles r JOIN operator_admissions a ON a.github_user_id=r.github_user_id
        WHERE r.github_user_id=? AND r.role='admin' AND a.revoked_at IS NULL)
      AND (?='admin' OR role!='admin' OR (SELECT COUNT(*) FROM platform_roles r JOIN operator_admissions a
        ON a.github_user_id=r.github_user_id WHERE r.role='admin' AND a.revoked_at IS NULL)>1)`)
      .bind(input.role ?? "user",actor.githubUserId,now,target,target,actor.githubUserId,input.role ?? "user"),
    event(actor,"role.changed",`${target}:${input.role ?? "revoked"}`),
    db.prepare(`UPDATE operator_admissions SET version=?,revoked_at=CASE WHEN ? IS NULL THEN ? ELSE revoked_at END
      WHERE github_user_id=? AND changes()=1`).bind(crypto.randomUUID(),input.role,now,target),
    db.prepare(`UPDATE operator_invitations SET revoked_at=? WHERE accepted_at IS NULL AND revoked_at IS NULL
      AND (issuer=? OR recipient=?) AND changes()=1`).bind(now,target,target),
  ]);
  if (!result[0].meta.changes) throw new Response("Role change rejected; keep at least one active Admin",{status:409});
}
