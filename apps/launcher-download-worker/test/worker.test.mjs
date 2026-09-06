import {test, after} from "node:test";
import assert from "node:assert/strict";
import {Miniflare} from "miniflare";
const POINTER = "v1/launcher/downloads/windows/x86_64/latest.json";
const ORIGIN = "https://downloads.koto-thing.com";
const installerKey = version => `v1/launcher/installers/windows/x86_64/${version}/PandD-Game-Launcher-Online-Installer.exe`;
const mf = new Miniflare({workers: [{config: {name: "download", type: "worker", compatibilityDate: "2026-09-02", manifest: {mainModule: "index.mjs", modules: {"index.mjs": {type: "esm", contents: await (await import("node:fs/promises")).readFile(new URL("../src/index.mjs", import.meta.url), "utf8")}}}, env: {RELEASES: {type: "r2", name: "test-releases"}}}}]});
after(() => mf.dispose());
const digest = "a".repeat(64);
const document = version => ({schemaVersion: 1, version, sha256: digest, size: 3});
async function publish(version) {
  const bucket = await mf.getR2Bucket("RELEASES");
  await bucket.put(installerKey(version), "exe", {customMetadata: {sha256: digest}});
  await bucket.put(POINTER, JSON.stringify(document(version)));
}
async function request(path = "/download/windows", method = "GET") { return mf.dispatchFetch(`https://downloads.koto-thing.com${path}`, {method, redirect: "manual"}); }
test("R2 missing, verified promotion, update, HEAD, malformed and missing artifacts", async () => {
  assert.equal((await request()).status, 503);
  await publish("1.0.5");
  let response = await request();
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), `${ORIGIN}/${installerKey("1.0.5")}`);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  await publish("1.1.0");
  response = await request("/download/windows?next=https://evil.test", "HEAD");
  assert.equal(response.status, 302);
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("Location"), `${ORIGIN}/${installerKey("1.1.0")}`);
  const bucket = await mf.getR2Bucket("RELEASES");
  await bucket.delete(installerKey("1.1.0"));
  assert.equal((await request()).status, 503);
  for (const value of ["{", JSON.stringify({...document("../../bad"), url: "https://evil.test"}), JSON.stringify({...document("1.0.5"), sha256: "b".repeat(64)}), "x".repeat(4097)]) {
    await bucket.put(POINTER, value);
    response = await request();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Location"), null);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
});
test("only the fixed GET/HEAD endpoint is served", async () => {
  assert.equal((await request("/v1/catalog/test.json")).status, 404);
  assert.equal((await request("/download/windows-other")).status, 404);
  const response = await request("/download/windows", "POST");
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "GET, HEAD");
});
