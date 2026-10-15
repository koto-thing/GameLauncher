import handler from "vinext/server/fetch-handler";
import { scheduledRequestRetention } from "./lib/request-retention";

export default {
  ...handler,

  // 保存期間の承認前は無効、明示したdry-runでもデータを変更しない
  async scheduled(controller: { scheduledTime: number }, env: Cloudflare.Env): Promise<void> {
    const result = await scheduledRequestRetention(env.DB, controller.scheduledTime, env.REQUEST_RETENTION_MODE);
    if (result.mode === "dry-run") console.info(JSON.stringify({ event: "request_retention_preview", ...result }));
  },
};
