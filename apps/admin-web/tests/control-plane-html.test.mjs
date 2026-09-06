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
  const csp = response.headers.get("content-security-policy") ?? "";
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /script-src 'self' 'unsafe-inline'/);
  assert.ok(!csp.includes("unsafe-eval"), "Production CSP must not include unsafe-eval");
  const html = await response.text();
  assert.match(html, /<title>PandD Deploy Control<\/title>/i);
  assert.match(html, /PandD/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
  assert.match(html, /lang="ja"/i);
  assert.match(html, /href="\/intake"/);
  assert.match(html, /href="\/music"/);
  assert.match(html, /href="\/game"/);
  assert.match(html, /Web Uploader \/ Intaker/);
  assert.match(html, /Music Uploader/);
});

test("server-renders game management at its dedicated route", async () => {
  const response = await render("/game");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /GameLauncher 公開申請・設定/);
  assert.match(html, /href="\/"/);
  assert.match(html, /href="\/intake"/);
});

test("server-renders the PandD intake uploader page without eval or 500 errors", async () => {
  const response = await render("/intake");
  assert.equal(response.status, 200, "GET /intake must return HTTP 200 without runtime 500");
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  const csp = response.headers.get("content-security-policy") ?? "";
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /script-src 'self' 'unsafe-inline'/);
  assert.ok(!csp.includes("unsafe-eval"), "Production CSP on /intake must not include unsafe-eval");
  const html = await response.text();
  assert.match(html, /<title>PandD Intake Uploader<\/title>/i);
  assert.match(html, /PandD/);
  assert.match(html, /INTAKE/);
  assert.doesNotMatch(html, /Error compiling schema|function code|Internal Server Error/i);
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
