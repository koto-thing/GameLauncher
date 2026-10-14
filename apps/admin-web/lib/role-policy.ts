export type Role = null | "assistant" | "executive" | "admin";
export type Permission = "operate" | "invite" | "roles" | "dangerous" | "settings";

/** @brief 未知のロールは権限なしとして扱い、旧権限から昇格させない */
export function normalizeRole(value: unknown): Role {
  return value === "admin" || value === "executive" || value === "assistant" ? value : null;
}

/** @brief UIとサーバーで共有する明示的な運営権限 */
export function permits(role: unknown, permission: Permission): boolean {
  const current = normalizeRole(role);
  if (current === "admin") return true;
  if (permission === "operate") return current === "executive" || current === "assistant";
  return (permission === "invite" || permission === "settings") && current === "executive";
}
