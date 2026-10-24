import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

/** Worker 実行環境で認可・Rust 検証・保存境界の順序を確認する */
test("Music upload executes Rust in workerd before reservation", async () => {
  const built = await build({
    entryPoints: [fileURLToPath(new URL("./fixtures/music-upload-worker.ts", import.meta.url))],
    bundle: true, write: false, format: "esm", platform: "browser", external: ["*.wasm?module"],
  });
  const source = built.outputFiles[0].text.replace(/"[^"\n]*music-upload-policy\.wasm\?module"/g, '"music-upload-policy.wasm"');
  const runtime = new Miniflare({
    workers: [{ config: {
      name: "music-upload-policy-test",
      compatibilityDate: "2026-10-08",
      manifest: { mainModule: "worker.mjs", modules: {
        "worker.mjs": { type: "esm", contents: source },
        "music-upload-policy.wasm": { type: "wasm", contents: await readFile(new URL("../lib/generated/music-upload-policy.wasm", import.meta.url)) },
      } },
    } }],
  });
  try {
    const valid = { bytes: 1, digest: "a".repeat(64), mime: "audio/wav", authenticated: true };
    for (const [change, expected] of [
      [{ authenticated: false, bytes: 0 }, { code: "UNAUTHENTICATED", stored: false }],
      [{ bytes: 0, digest: "bad" }, { code: "TOO_LARGE", stored: false }],
      [{ digest: "bad" }, { code: "INVALID", stored: false }],
      [{ mime: "image/png" }, { code: "INVALID", stored: false }],
    ]) {
      const response = await runtime.dispatchFetch("http://localhost/", { method: "POST", body: JSON.stringify({ ...valid, ...change }) });
      assert.deepEqual(await response.json(), expected);
    }
    const response = await runtime.dispatchFetch("http://localhost/", { method: "POST", body: JSON.stringify(valid) });
    const result = await response.json();
    assert.equal(result.stored, true);
    assert.deepEqual(result.result.args.slice(0, 5), ["game", "audio", 1, valid.digest, valid.mime]);
  } finally {
    await runtime.dispose();
  }
});
