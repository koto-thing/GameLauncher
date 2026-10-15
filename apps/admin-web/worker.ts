import handler from "vinext/server/fetch-handler";
import { scheduledRequestRetention } from "./lib/request-retention";
import { observeD1 } from "../../packages/observability/d1";

export default {
  ...handler,

  // 承認済みの既存365日保持を継続し、停止とdry-runも明示的に選べる
  async scheduled(controller: { scheduledTime: number }, env: Cloudflare.Env): Promise<void> {
    const db = observeD1(env.DB, "deployment-control-plane", env.D1_METRICS_ENABLED === "true");
    const result = await scheduledRequestRetention(db, controller.scheduledTime, env.REQUEST_RETENTION_MODE);
    if (result.mode === "dry-run") console.info(JSON.stringify({ event: "request_retention_preview", ...result }));
  },
};
