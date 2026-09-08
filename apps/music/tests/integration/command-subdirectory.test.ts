import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { build } from "vite";
import { createPhpServer, createRuntime } from "../support/rental-runtime.mjs";
import { seed } from "../../scripts/seed.mjs";
import { encodeCommand } from "../../src/domain/command-code";

test(
  "real subdirectory build + PHP + CSP: scan reload, lookup and track navigation",
  { timeout: 90000 },
  /** @brief ルート配置のdistを流用せず、実際にbasePath付きでビルドしてブラウザー確認する */ async () => {
    const output = path.resolve("build/command-subdirectory");
    await build({
      base: "/music/",
      build: { outDir: output },
      logLevel: "silent",
    });
    const php = await createPhpServer({
      documentRoot: output,
      basePath: "/music",
    });
    let runtime: Awaited<ReturnType<typeof createRuntime>> | undefined;
    process.env.PLAYWRIGHT_BROWSERS_PATH = path.resolve("build/browsers");
    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch({ headless: true });
    try {
      runtime = await createRuntime({ php });
      await seed(runtime);
      const games = await (
          await fetch(`${php.origin}/music/api/public/catalogue`)
        ).json(),
        track = games[0].tracks[0];
      const page = await browser.newPage(),
        failures: string[] = [];
      page.on(
        "pageerror",
        /** @brief CSPや遅延ロードの未処理失敗を検出する */ (e) =>
          failures.push(e.message),
      );
      const response = await page.goto(`${php.origin}/music/scan`);
      assert.match(
        response!.headers()["content-security-policy"],
        /script-src 'self'/,
      );
      await page.reload();
      await page
        .getByLabel("記号またはASCIIを貼り付け")
        .fill(encodeCommand(track.commandCode.codeId));
      await page.getByRole("button", { name: "入力枠へ反映" }).click();
      await page.getByRole("button", { name: "読み込む", exact: true }).click();
      await page.waitForURL(`${php.origin}/music/tracks/${track.id}`);
      await page.getByRole("button", { name: "共有", exact: true }).click();
      await page
        .getByRole("button", { name: "コマンドコード", exact: true })
        .click();
      await page.locator(".command-image").waitFor();
      assert.deepEqual(failures, []);
    } finally {
      await browser.close();
      await runtime?.dispose();
      await php.close();
    }
  },
);
