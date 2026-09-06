import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import {
  createPhpServer,
  createRuntime,
} from "../tests/support/rental-runtime.mjs";
import { seed } from "./seed.mjs";

// 本物の管理Use Caseで公開後にworkerdを停止し、PHP単独の聴取を測る。
const php = await createPhpServer();
let runtime, browser;
try {
  runtime = await createRuntime({ php });
  await seed(runtime);
  const workerUrl = await runtime.runtime.ready;
  await runtime.dispose();
  runtime = null;
  await assert.rejects(fetch(workerUrl, { signal: AbortSignal.timeout(2000) }));
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const requests = [],
    errors = [];
  page.on(
    "request",
    /** @brief 全通信先を記録する。 @param request ブラウザー要求。 */ (
      request,
    ) => requests.push({ method: request.method(), url: request.url() }),
  );
  page.on(
    "pageerror",
    /** @brief 実ページの未処理例外を記録する。 @param error 例外。 */ (
      error,
    ) => errors.push(error.message),
  );
  await page.route(
    "**/*",
    /** @brief 公開origin以外は全て遮断し試行も後で検出する。 @param route 通信。 */ (
      route,
    ) =>
      new URL(route.request().url()).origin === php.origin
        ? route.continue()
        : route.abort(),
  );
  const cdp = await context.newCDPSession(page);
  let transferredBytes = 0;
  cdp.on("Network.loadingFinished", /** @brief 完了した実HTTP応答の転送量を合計する。 @param event CDP転送結果。 */ event => { transferredBytes += event.encodedDataLength; });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 80,
    downloadThroughput: 131072,
    uploadThroughput: 65536,
  });
  await cdp.send("Performance.enable");
  await page.goto(php.origin);
  await page.locator(".game-card").first().waitFor();
  await page.locator(".game-card").first().click();
  await page.locator(".track-list a").first().click();
  const trackUrl = page.url();
  await page.reload();
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await page.getByRole("button", { name: "一時停止", exact: true }).waitFor();
  const before = (await cdp.send("Performance.getMetrics")).metrics;
  await page.getByLabel("リピート", { exact: true }).selectOption("region");
  await page.waitForTimeout(4600);
  const position = Number(
    await page.getByLabel("再生位置", { exact: true }).inputValue(),
  );
  assert.ok(position >= 1 && position < 3);
  await page.getByLabel("再生位置", { exact: true }).fill("2");
  await page.getByRole("link", { name: "ライブラリ", exact: true }).click();
  await page
    .getByRole("link", { name: "このサイトについて", exact: true })
    .click();
  await page.locator(".mini-player").waitFor();
  await page.waitForTimeout(2000);
  const after = (await cdp.send("Performance.getMetrics")).metrics;
  await page.screenshot({
    path: "build/public-workers-stopped-390.png",
    fullPage: true,
  });
  const foreign = requests.filter(
    /** @brief 別originへの試行もゼロにする。 @param request 記録。 @returns 外部通信か。 */ (
      request,
    ) => new URL(request.url).origin !== php.origin,
  );
  assert.deepEqual(foreign, []);
  assert.deepEqual(errors, []);
  /** @brief Chromiumの測定値を名前で取り出す。 @param metrics CDP値。 @param name 名前。 @returns 測定値。 */
  const metric = (metrics, name) =>
    metrics.find(
      /** @brief 指定メトリクスを選ぶ。 */ (value) => value.name === name,
    )?.value ?? null;
  const report = {
    executedAt: new Date().toISOString(),
    controlPlaneStopped: true,
    publicOrigin: php.origin,
    trackUrl,
    requests,
    externalRequests: foreign.length,
    errors,
    regionPositionSeconds: position,
    metrics: {
      networkTransferredBytes: transferredBytes,
      taskCpuSeconds:
        metric(after, "TaskDuration") - metric(before, "TaskDuration"),
      observedWallSeconds:
        metric(after, "Timestamp") - metric(before, "Timestamp"),
      jsHeapUsedBytes: metric(after, "JSHeapUsedSize"),
      jsHeapTotalBytes: metric(after, "JSHeapTotalSize"),
    },
    network: {
      latencyMs: 80,
      downloadBytesPerSecond: 131072,
      uploadBytesPerSecond: 65536,
    },
    limitation:
      "Desktop Chromium viewport emulation; CPU is CDP main-thread TaskDuration, not whole-machine or mobile energy usage.",
  };
  await writeFile(
    "build/public-independence.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      controlPlaneStopped: true,
      requests: requests.length,
      externalRequests: 0,
      metrics: report.metrics,
    }),
  );
} finally {
  await browser?.close();
  await runtime?.dispose();
  await php.close();
}
