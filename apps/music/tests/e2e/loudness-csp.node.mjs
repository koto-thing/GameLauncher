/* global AbortController, Blob */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { buildContentSecurityPolicy } from "../../../admin-web/lib/csp.ts";
import { toneWav } from "../support/fixtures.mjs";

process.env.PLAYWRIGHT_BROWSERS_PATH = fileURLToPath(new URL("../../build/browsers", import.meta.url));
const { chromium, firefox } = await import("@playwright/test");
const wasm = await readFile(new URL("../../../../packages/music-loudness/generated/music_loudness_bg.wasm", import.meta.url));
// Viteのinline WASMと同じ同梱バイトを、検証用ESMへ組み込む
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../../src/infrastructure/audio/analyze-loudness.ts", import.meta.url))],
  bundle: true, format: "esm", write: false,
  plugins: [{
    name: "inline-measurement-wasm",
    /** @brief 実WASMをViteと同じdata URLに解決する */
    setup(builder) {
      builder.onResolve({ filter: /\.wasm\?url&inline$/ }, /** @brief 同梱WASMだけを捕捉する */ () => ({ path: "measurement", namespace: "wasm" }));
      builder.onLoad({ filter: /.*/, namespace: "wasm" }, /** @brief ソースを変更せず同じ実バイナリーを埋め込む */ () => ({ contents: `export default "data:application/wasm;base64,${wasm.toString("base64")}";`, loader: "js" }));
    },
  }],
});

for (const [name, engine] of [["chromium", chromium], ["firefox", firefox]]) {
  test(`${name}: production CSP allows actual analysis only on /music`, /** @brief 本番ポリシーを実ブラウザーで強制し、音量解析と他ページの拒否を確認する。 */ async () => {
    const browser = await engine.launch({ headless: true });
    try {
      for (const pathname of ["/music", "/intake"]) {
        const page = await browser.newPage();
        await page.route("http://music.test/**", /** @brief 外部通信なしで同一originのHTMLと解析モジュールを配信する。 */ async (route) => {
          const asset = new URL(route.request().url()).pathname === "/analyzer.js";
          await route.fulfill({ status: 200, contentType: asset ? "text/javascript" : "text/html",
            headers: { "Content-Security-Policy": buildContentSecurityPolicy(false, pathname) },
            body: asset ? bundle.outputFiles[0].text : "<!doctype html><title>Music CSP verification</title>" });
        });
        await page.goto(`http://music.test${pathname}`);
        const result = await page.evaluate(/** @brief 本物のブラウザーデコードとLoudnessMeterのWASMで全曲を解析する */ async (bytes) => {
          const { createLoudnessAnalyzer } = await import("/analyzer.js");
          const analyze = createLoudnessAnalyzer(/** @brief ローカルBlob解析では音源APIを呼ばせない */ () => { throw new Error("Unexpected media fetch"); });
          try {
            const measurement = await analyze({ audioAssetId: "fixture", audioBytes: bytes.length, durationSeconds: 4, channels: 1 },
              new AbortController().signal, /** @brief 検証中の進捗表示は不要 */ () => {}, new Blob([Uint8Array.from(bytes)]));
            return { measurement, error: null };
          } catch (error) { return { measurement: null, error: String(error) }; }
        }, Array.from(toneWav()));
        if (pathname === "/music") {
          assert.equal(result.error, null);
          assert.ok(Number.isFinite(result.measurement.integratedLufs));
          assert.ok(Number.isFinite(result.measurement.truePeakDbtp));
        } else {
          assert.equal(result.measurement, null);
          assert.match(result.error, /wasm|webassembly|content.security|unsafe-eval/i);
        }
        await page.close();
      }
    } finally { await browser.close(); }
  });
}
