import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { createAdminTestHarness } from "./helpers/admin-worker-harness.mjs";
import { assertBrowserWrite, assertSameOrigin } from "../lib/request-security.ts";

const server = createAdminTestHarness();

before(() => server.listen());
after(() => server.close());

// ビルド済みWorkerを本番と同じランタイムで描画する
async function render(path = "/") {
  return server.fetch(`http://localhost${path}`, { redirect: "manual", headers: { accept: "text/html" } });
}

// 未認証の管理ページを同じログイン入口へ転送し、APIの401契約は保つ
for (const path of ["/", "/game", "/intake", "/editions", "/music", "/lt", "/members", "/analytics", "/game?view=recent"]) {
  test(`anonymous ${path} redirects to the shared login`, async () => {
    const response = await render(path);
    assert.equal(response.status, 307);
    const destination = new URL(response.headers.get("location"), "http://localhost");
    assert.equal(destination.pathname, "/login");
    assert.equal(destination.searchParams.get("returnTo"), path);
    assert.match(response.headers.get("cache-control"), /no-store/);
  });
}

// 共通ログイン自体は匿名で描画され、期限とセキュリティヘッダーを表示する
test("shared login renders without a redirect loop or private data", async () => {
  const response = await render("/login?returnTo=%2Fintake");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.ok(!response.headers.get("content-security-policy").includes("unsafe-eval"));
  const html = await response.text();
  assert.match(html, /ログイン/);
  assert.match(html, /6時間/);
  assert.doesNotMatch(html, /SESSION_SECRET|ANALYTICS_READ_TOKEN|Internal Server Error/);
});

test("session and analytics APIs retain JSON unauthorized responses", async () => {
  for (const path of ["/api/auth/session", "/api/analytics/games"]) {
    const response = await server.fetch(`http://localhost${path}`);
    assert.equal(response.status, 401);
    assert.match(response.headers.get("content-type"), /application\/json/);
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.equal(response.headers.get("location"), null);
  }
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
