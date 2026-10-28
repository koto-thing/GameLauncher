import { env } from "cloudflare:workers";
import { requireRecentIdentity } from "@/lib/auth";
import { ensureSchema, getD1 } from "@/db/initialize";
import { assertBrowserWrite } from "@/lib/request-security";
import { validSubscription, type PushEnv } from "@/lib/lt/push";

/**
 * 本人の通知設定を読み取り、明示された購読や受信停止を保存する
 * @param request 認証済みブラウザーからの要求
 * @returns 本人の設定または情報を限定したエラー
 */
async function handle(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "no-store, private" };
  try {
    const user = await requireRecentIdentity(request);
    if (!["admin", "executive", "assistant"].includes(user.role ?? "")) return Response.json({ error: "運営権限が必要です" }, { status: 403, headers });
    await ensureSchema();
    const db = getD1();
    const runtime = env as unknown as PushEnv;
    if (request.method === "POST") {
      assertBrowserWrite(request);
      const text = await request.text();
      if (text.length > 8192) return Response.json({ error: "入力が大きすぎます" }, { status: 413, headers });
      const body = JSON.parse(text);
      if (body.enabled === false) {
        // 全端末を同時に停止し、再有効化は各端末での明示登録を要求する
        await db.batch([
          db.prepare("DELETE FROM lt_push_subscriptions WHERE user_id=?").bind(user.githubUserId),
          db.prepare("DELETE FROM lt_push_preferences WHERE user_id=?").bind(user.githubUserId),
        ]);
      } else {
        const subscription = validSubscription(body.subscription);
        if (body.enabled !== true || !subscription) return Response.json({ error: "通知の登録情報が不正です" }, { status: 422, headers });
        if (!runtime.LT_PUSH_PUBLIC_KEY || !runtime.LT_PUSH_PRIVATE_KEY) return Response.json({ error: "通知の配信設定が未完了です" }, { status: 503, headers });
        await db.batch([
          db.prepare("INSERT INTO lt_push_preferences(user_id,enabled,admission_version) VALUES(?,1,?) ON CONFLICT(user_id) DO UPDATE SET enabled=1,admission_version=excluded.admission_version").bind(user.githubUserId, user.admissionVersion),
          db.prepare("INSERT INTO lt_push_subscriptions(endpoint,user_id,subscription) VALUES(?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,subscription=excluded.subscription,signature='',lease_until=0,last_error=NULL").bind(subscription.endpoint, user.githubUserId, JSON.stringify(subscription)),
        ]);
      }
    }
    const preference = await db.prepare("SELECT enabled FROM lt_push_preferences WHERE user_id=? AND admission_version=?").bind(user.githubUserId, user.admissionVersion).first<{ enabled: number }>();
    const endpoint = new URL(request.url).searchParams.get("endpoint");
    const registered = endpoint ? await db.prepare("SELECT 1 FROM lt_push_subscriptions WHERE endpoint=? AND user_id=?").bind(endpoint, user.githubUserId).first() : null;
    const status = await db.prepare("SELECT checked_at,outcome FROM lt_push_status WHERE id=1").first();
    const failures = await db.prepare("SELECT count(*) AS count FROM lt_push_subscriptions WHERE user_id=? AND last_error IS NOT NULL").bind(user.githubUserId).first();
    return Response.json({ enabled: preference?.enabled === 1, registered: Boolean(registered), publicKey: runtime.LT_PUSH_PRIVATE_KEY ? runtime.LT_PUSH_PUBLIC_KEY ?? null : null, userId: user.githubUserId, status, failures: failures?.count ?? 0 }, { headers });
  } catch (error) {
    const status = error instanceof Response ? error.status : error instanceof SyntaxError ? 422 : 503;
    return Response.json({ error: status === 401 || status === 403 ? "ログインと運営権限を確認してください" : "通知設定を取得・保存できませんでした" }, { status, headers });
  }
}

/**
 * 本人の通知設定を取得する
 * @param request 読み取り要求
 * @returns 本人だけの通知設定
 */
export async function GET(request: Request): Promise<Response> { return handle(request); }

/**
 * 本人の明示操作で通知設定を変更する
 * @param request 設定変更要求
 * @returns 保存後の通知設定
 */
export async function POST(request: Request): Promise<Response> { return handle(request); }
