import { dispatchOperationsPush, type PushEnv } from "./lib/lt/push";
import handler from "vinext/server/fetch-handler";
import { scheduledRequestRetention } from "./lib/request-retention";
import { observeD1 } from "../../packages/observability/d1";

export default {
  ...handler,

  /**
   * 要対応通知を定期配信し、既存の日次保持処理を実行する
   * @param controller 定期実行時刻とcron式
   * @param env データベースと配信設定
   * @returns 処理完了を示すPromise
   */
  async scheduled(controller: { scheduledTime: number; cron: string }, env: Cloudflare.Env): Promise<void> {
    if (controller.cron === "*/5 * * * *") {
      await dispatchOperationsPush(env as unknown as PushEnv, controller.scheduledTime);
      return;
    }
    const db = observeD1(env.DB, "deployment-control-plane", env.D1_METRICS_ENABLED === "true");
    const result = await scheduledRequestRetention(db, controller.scheduledTime, env.REQUEST_RETENTION_MODE);
    if (result.mode === "dry-run") console.info(JSON.stringify({ event: "request_retention_preview", ...result }));
  },
};
