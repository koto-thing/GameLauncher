import handler from "vinext/server/fetch-handler";
import { pruneRequestHistory } from "./lib/request-retention";

export default {
  ...handler,

  // 毎日のCron実行で保存期限を過ぎた申請履歴を削除する
  async scheduled(controller: { scheduledTime: number }, env: Cloudflare.Env): Promise<void> {
    await pruneRequestHistory(env.DB, controller.scheduledTime);
  },
};
