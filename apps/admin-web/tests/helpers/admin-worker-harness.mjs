import { fileURLToPath } from "node:url";
import { createTestHarness } from "wrangler";

/**
 * 単独の管理画面テストに内部APIの明示的な利用不能状態を提供する
 * @param options 管理Workerの検証用設定
 * @returns 外部サービスを呼ばない検証環境
 */
export function createAdminTestHarness(options = {}) {
  const main = fileURLToPath(new URL("../fixtures/analytics-unavailable-worker.js", import.meta.url));
  return createTestHarness({
    workers: [
      { configPath: new URL("../../dist/server/wrangler.json", import.meta.url), ...options },
      { config: { name: "pandd-platform-api", main, compatibility_date: "2026-10-08" } },
      { config: { name: "pandd-platform-api-staging", main, compatibility_date: "2026-10-08" } },
      { config: { name: "pandd-lt-api", main: fileURLToPath(new URL("../fixtures/lt-unavailable-worker.js", import.meta.url)), compatibility_date: "2026-10-08" } },
    ],
  });
}
