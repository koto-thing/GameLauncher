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
    assert.equal(actor.actorId, "fixture-operator"); assert.equal(actor.role, "assistant"); assert.ok(actor.requestId);
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


test("fake内部adapterは同一操作の再送とstale versionを区別する", async () => {
  let version = 1; const receipts = new Map();
  const adapter = { fetch: async (request, context) => {
    assert.equal(context.role, "executive");
    const payload = await request.json();
    if (receipts.has(payload.operationId)) return Response.json(receipts.get(payload.operationId));
    if (payload.expectedVersion !== version) return Response.json({ error: { code: "VERSION_CONFLICT", requestId: context.requestId } }, { status: 409 });
    const result = { version: ++version }; receipts.set(payload.operationId, result); return Response.json(result);
  } };
  const request = operationId => new Request(url + "/fixture/cancel", { method: "POST", headers: { origin: "https://admin.example.invalid", "content-type": "application/json", "x-role": "admin" }, body: JSON.stringify({ expectedVersion: 1, operationId, data: {} }) });
  const first = await proxyLtCore(request("same"), identity("executive"), adapter);
  const replay = await proxyLtCore(request("same"), identity("executive"), adapter);
  assert.deepEqual(await first.json(), await replay.json());
  assert.equal((await proxyLtCore(request("stale"), identity("executive"), adapter)).status, 409);
  assert.equal(version, 2);
});
