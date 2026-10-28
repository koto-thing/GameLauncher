import { dispatchOperationsPush, type PushEnv } from "./lib/lt/push";
import handler from "vinext/server/fetch-handler";
import { scheduledRequestRetention } from "./lib/request-retention";
import { observeD1 } from "../../packages/observability/d1";

/**
 * 保持期限を過ぎた要求を整理し、試行設定の場合は件数を記録する
 * @param env データベースと保持設定
 * @param now 定期実行時刻のミリ秒
 * @returns 戻り値なし
 */
async function retainRequests(env: Cloudflare.Env, now: number): Promise<void> {
  const db = observeD1(env.DB, "deployment-control-plane", env.D1_METRICS_ENABLED === "true");
  const result = await scheduledRequestRetention(db, now, env.REQUEST_RETENTION_MODE);
  if (result.mode === "dry-run") console.info(JSON.stringify({ event: "request_retention_preview", ...result }));
}

export default {
  ...handler,

  /**
   * 単一の定期実行で通知を配信し、日本時間3時だけ保持処理を実行する
   * @param controller 定期実行時刻とcron式
   * @param env データベースと配信設定
   * @returns 処理完了を示すPromise
   */
  async scheduled(controller: { scheduledTime: number; cron: string }, env: Cloudflare.Env): Promise<void> {
    const time = new Date(controller.scheduledTime);
    const tasks: Promise<unknown>[] = [dispatchOperationsPush(env as unknown as PushEnv, controller.scheduledTime)];
    if (time.getUTCHours() === 18 && time.getUTCMinutes() === 0) tasks.push(retainRequests(env, controller.scheduledTime));

    // 一方の障害でも他方を最後まで実行し、失敗自体は定期処理へ返す
    const results = await Promise.allSettled(tasks);
    for (const result of results) if (result.status === "rejected") throw result.reason;
  },
};
