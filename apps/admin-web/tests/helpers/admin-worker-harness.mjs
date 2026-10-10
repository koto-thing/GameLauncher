import { fileURLToPath } from "node:url";
import { createTestHarness } from "wrangler";

/** @brief 単独の管理画面テストに統計APIの利用不能状態を提供する */
export function createAdminTestHarness() {
  const main = fileURLToPath(new URL("../fixtures/analytics-unavailable-worker.js", import.meta.url));
  return createTestHarness({
    workers: [
      { configPath: new URL("../../dist/server/wrangler.json", import.meta.url) },
      { config: { name: "pandd-platform-api", main, compatibility_date: "2026-10-08" } },
      { config: { name: "pandd-platform-api-staging", main, compatibility_date: "2026-10-08" } },
    ],
  });
}
