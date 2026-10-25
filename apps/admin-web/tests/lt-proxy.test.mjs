import test from "node:test";
import assert from "node:assert/strict";
import { proxyLtCore } from "../lib/lt/proxy-core.ts";

const url = "https://admin.example.invalid/api/lt/v1/operator/events";
const identity = role => async () => ({ githubUserId: "fixture-operator", role });

test("未認証・権限不足は内部サービスへ届かない", async () => {
  let calls = 0;
  const adapter = { fetch: async () => { calls++; return Response.json({}); } };
  assert.equal((await proxyLtCore(new Request(url), async () => { throw new Response("", { status: 401 }); }, adapter)).status, 401);
  assert.equal((await proxyLtCore(new Request(url), identity(null), adapter)).status, 403);
  assert.equal(calls, 0);
});

test("偽造主体とCookieを廃棄し検証済み主体だけを渡す", async () => {
  const request = new Request(url, { headers: { cookie: "secret", authorization: "Bearer forged", "x-actor-id": "other", "x-role": "admin" } });
  const result = await proxyLtCore(request, identity("assistant"), { fetch: async (internal, actor) => {
    assert.equal(internal.headers.get("cookie"), null);
    assert.equal(internal.headers.get("authorization"), null);
    assert.equal(internal.headers.get("x-actor-id"), null);
    assert.equal(internal.headers.get("x-role"), null);
    assert.deepEqual(actor, { id: "fixture-operator", role: "assistant" });
    return Response.json({ items: [], nextCursor: null });
  } });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store, private");
});

test("Origin無しと外部Originの書込みを拒否する", async () => {
  for (const origin of [null, "https://evil.invalid"]) {
    const headers = origin ? { origin } : {};
    assert.equal((await proxyLtCore(new Request(url, { method: "POST", headers }), identity("admin"))).status, 403);
  }
});

test("メール変更は上書きしない・本人用ルートへ到達しない", async () => {
  const path = url.replace("events", "applications/a/email-change/confirm");
  for (const [role, status] of [["assistant", 403], ["executive", 501], ["admin", 501]]) {
    assert.equal((await proxyLtCore(new Request(path, { method: "POST", headers: { origin: "https://admin.example.invalid" } }), identity(role))).status, status);
  }
  assert.equal((await proxyLtCore(new Request(url.replace("operator/events", "applications/other")), identity("admin"))).status, 404);
});

test("接続なしは503で閉じ、fakeを本番fallbackにしない", async () => {
  assert.equal((await proxyLtCore(new Request(url), identity("admin"))).status, 503);
});
