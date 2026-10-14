import { ensureSchema, getD1 } from "@/db/initialize";
import type { SessionUser } from "@/lib/auth";

import { normalizeRole, permits, type Role, type Permission } from "@/lib/role-policy";
export { normalizeRole, permits, type Role, type Permission } from "@/lib/role-policy";

/** @brief セッションに保存された権限を使わず最新のDBロールを取得する */
export async function currentRole(id: string): Promise<Role> {
  await ensureSchema();
  const row = await getD1().prepare("SELECT role FROM platform_roles WHERE github_user_id=?").bind(id).first<{ role: string }>();
  return normalizeRole(row?.role);
}

/** @brief 公開・復旧・招待・危険操作の実行者と結果を記録する */
export async function recordOperation(actor: SessionUser | null, action: string, target: string, result: string) {
  await ensureSchema();
  await getD1().prepare("INSERT INTO operation_events(id,actor,action,target,result,at) VALUES(?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), actor?.githubUserId ?? null, String(action).slice(0,80), String(target).slice(0,200), result, new Date().toISOString()).run();
}

/** @brief サーバー操作ごとに最新権限を確認し拒否も記録する */
export async function requirePermission(actor: SessionUser, permission: Permission): Promise<Role> {
  const role = await currentRole(actor.githubUserId);
  if (!permits(role, permission)) {
    await recordOperation(actor, `permission.${permission}`, "", "denied");
    throw new Response("この操作の権限がありません", { status: 403 });
  }
  return role;
}
