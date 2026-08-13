import assert from "node:assert/strict";
import test from "node:test";
import { assertBrowserWrite } from "../lib/request-security.ts";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
const workerPromise = import(workerUrl.href);

async function render(path = "/") {
  const { default: worker } = await workerPromise;
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the PandD deployment control plane", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  const html = await response.text();
  assert.match(html, /<title>PandD Deploy Control<\/title>/i);
  assert.match(html, /PandD/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
  assert.match(html, /lang="ja"/i);
});

test("rejects cross-origin and origin-less browser writes", async () => {
  const crossOrigin = new Request("http://localhost/api/control", {
    method: "POST",
    headers: { origin: "https://evil.example", "content-type": "application/json" },
    body: JSON.stringify({ action: "noop" }),
  });
  assert.throws(() => assertBrowserWrite(crossOrigin), (error) => error.status === 403);

  const originLess = new Request("http://localhost/api/control", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "noop" }),
  });
  assert.throws(() => assertBrowserWrite(originLess), (error) => error.status === 403);
});

test("accepts a same-origin browser write for subsequent authentication", () => {
  const request = new Request("http://localhost/api/control", {
    method: "POST",
    headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ action: "noop" }),
  });
  assert.doesNotThrow(() => assertBrowserWrite(request));
});
