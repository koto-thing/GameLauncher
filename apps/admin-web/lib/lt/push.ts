import { buildPushPayload, type PushSubscription } from "@block65/webcrypto-web-push";
import type { OperationsSnapshot } from "./monitor-types.ts";
import type { LtBindingEnv } from "./internal-adapter.ts";

export type PushEnv = LtBindingEnv & { DB: D1Database; LT_PUSH_PUBLIC_KEY?: string; LT_PUSH_PRIVATE_KEY?: string };

/**
 * ブラウザー購読を検証し、固定のプッシュサービスだけを送信先に許可する
 * @param value ブラウザーから受け取った購読
 * @returns 検証済み購読、不正ならnull
 */
export function validSubscription(value: unknown): PushSubscription | null {
  if (!value || typeof value !== "object") return null;
  const s = value as PushSubscription;
  if (typeof s.endpoint !== "string" || s.endpoint.length > 2048) return null;
  let url: URL;
  try { url = new URL(s.endpoint); } catch { return null; }
  const host = url.hostname;
  const allowed = host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com" || host === "web.push.apple.com" || host.endsWith(".notify.windows.com");
  if (!allowed || url.protocol !== "https:" || url.port || url.username || url.password || url.hash) return null;
  if (!s.keys || !/^[\w-]{87}$/.test(s.keys.p256dh) || !/^[\w-]{22}$/.test(s.keys.auth)) return null;
  return { endpoint: url.href, expirationTime: s.expirationTime ?? null, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } };
}

/**
 * 状態の変化だけを通知するための識別子を生成する
 * @param snapshot 運営の現在状態
 * @returns 並び順に依存しない要対応識別子
 */
export function attentionKeys(snapshot: OperationsSnapshot): string[] {
  const keys = snapshot.items.map(item => item.key);
  if (snapshot.maintenance.status !== "ok") keys.push(`maintenance:${snapshot.maintenance.status}`);
  for (const item of snapshot.mail.states) {
    if (["failed", "uncertain"].includes(item.state) && item.count) keys.push(`mail:${item.state}:${item.count}`);
  }
  if (snapshot.mail.mode !== "http" || !snapshot.mail.configured) keys.push("mail:disabled");
  if (snapshot.mail.testRecipientOnly) keys.push("mail:test-only");
  if (snapshot.mail.backlog.oldestAt !== null && snapshot.checkedAt - snapshot.mail.backlog.oldestAt > 900000) keys.push("mail:delayed");
  return keys.sort();
}

/**
 * 定期処理から認可済み購読へ要対応事項の変化を配信する
 * @param env DB、内部APIと通知署名鍵
 * @param now 実行時刻のミリ秒
 * @returns 戻り値なし
 * @throws 状態取得やデータベースへの記録に失敗した場合
 */
export async function dispatchOperationsPush(env: PushEnv, now: number): Promise<void> {
  const db = env.DB;
  if (!env.LT_INTERNAL || !env.LT_PUSH_PUBLIC_KEY || !env.LT_PUSH_PRIVATE_KEY) {
    await db.prepare("UPDATE lt_push_status SET checked_at=?,outcome='disabled' WHERE id=1").bind(now).run();
    return;
  }
  try {
    const response = await env.LT_INTERNAL.operate({ actorId: "operations-monitor", role: "admin", requestId: crypto.randomUUID() }, new Request("https://lt.internal/api/lt/v1/operator/monitor"));
    if (!response.ok) throw new Error("Operations monitor unavailable");
    const snapshot = await response.json() as OperationsSnapshot;
    const keys = attentionKeys(snapshot);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(keys)));
    const signature = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");

    // 無効化・退会・再承認された購読は削除し、同じユーザーIDでも自動復活させない
    await db.prepare("DELETE FROM lt_push_subscriptions WHERE NOT EXISTS(SELECT 1 FROM lt_push_preferences p JOIN active_platform_roles r ON r.github_user_id=p.user_id JOIN operator_admissions a ON a.github_user_id=p.user_id WHERE p.user_id=lt_push_subscriptions.user_id AND p.enabled=1 AND p.admission_version=a.version)").run();
    const subscriptions = await db.prepare("SELECT endpoint,user_id,subscription,signature FROM lt_push_subscriptions WHERE signature!=? AND lease_until<=? ORDER BY COALESCE(last_sent_at,0),endpoint LIMIT 10").bind(signature, now).all<{ endpoint: string; user_id: string; subscription: string; signature: string }>();
    for (const row of subscriptions.results) {
      // 原子的claimと配信直前の在籍確認で重複実行と受信停止の競合を抑える
      const claim = await db.prepare("UPDATE lt_push_subscriptions SET lease_until=? WHERE endpoint=? AND lease_until<=? AND EXISTS(SELECT 1 FROM lt_push_preferences p JOIN active_platform_roles r ON r.github_user_id=p.user_id JOIN operator_admissions a ON a.github_user_id=p.user_id WHERE p.user_id=lt_push_subscriptions.user_id AND p.enabled=1 AND p.admission_version=a.version) RETURNING endpoint").bind(now + 300000, row.endpoint, now).first();
      if (!claim) continue;
      try {
        if (keys.length) {
          const subscription = validSubscription(JSON.parse(row.subscription));
          if (!subscription) throw new Error("Invalid subscription");
          const payload = await buildPushPayload({ data: "{}", options: { ttl: 300 } }, subscription, { subject: "mailto:panddmail@gmail.com", publicKey: env.LT_PUSH_PUBLIC_KEY, privateKey: env.LT_PUSH_PRIVATE_KEY });
          const result = await fetch(subscription.endpoint, { ...payload, redirect: "error", signal: AbortSignal.timeout(10000) });
          if (result.status === 404 || result.status === 410) {
            await db.prepare("DELETE FROM lt_push_subscriptions WHERE endpoint=?").bind(row.endpoint).run();
            continue;
          }
          if (!result.ok) throw new Error("Push service rejected delivery");
        }
        await db.prepare("UPDATE lt_push_subscriptions SET signature=?,last_sent_at=?,last_error=NULL,lease_until=0 WHERE endpoint=?").bind(signature, now, row.endpoint).run();
      } catch {
        // 宛先や鍵をログへ出さず、次の3時間周期で再試行する
        await db.prepare("UPDATE lt_push_subscriptions SET last_error=? WHERE endpoint=?").bind(now, row.endpoint).run();
      }
    }
    await db.prepare("UPDATE lt_push_status SET checked_at=?,outcome='ok' WHERE id=1").bind(now).run();
  } catch (error) {
    await db.prepare("UPDATE lt_push_status SET checked_at=?,outcome='failed' WHERE id=1").bind(now).run();
    throw error;
  }
}
