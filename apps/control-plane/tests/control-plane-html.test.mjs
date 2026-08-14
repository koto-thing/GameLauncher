import assert from "node:assert/strict";
import test from "node:test";
import { assertBrowserWrite, assertSameOrigin } from "../lib/request-security.ts";

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

test("server-renders the PandD intake uploader page", async () => {
  const response = await render("/intake");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /PandD/);
  assert.match(html, /INTAKE/);
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

test("assertSameOrigin rejects cross-origin and cross-site requests with 403", () => {
  const crossOrigin = new Request("http://localhost/api/intake/uploads", {
    method: "POST",
    headers: { origin: "https://evil.example", "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.throws(() => assertSameOrigin(crossOrigin), (error) => error.status === 403);

  const crossSite = new Request("http://localhost/api/intake/uploads", {
    method: "POST",
    headers: { "sec-fetch-site": "cross-site", "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.throws(() => assertSameOrigin(crossSite), (error) => error.status === 403);
});

test("assertSameOrigin accepts same-origin requests", () => {
  const request = new Request("http://localhost/api/intake/uploads", {
    method: "POST",
    headers: { origin: "http://localhost", "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.doesNotThrow(() => assertSameOrigin(request));
});
