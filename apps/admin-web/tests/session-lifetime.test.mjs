import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./helpers/role-fixture.mjs";

// 実際のDB許可と署名付きCookieで再認証の上限を確認する
test("sessions and management actions expire after three hours", async t => {
  const f = await fixture(t,{role:"admin"});
  const start = Date.now();
  const originalNow = Date.now;
  let now = start;
  Date.now = () => now;
  try {
    f.actor.authenticatedAt = new Date(start).toISOString();
    const cookie = await f.auth.createSessionCookie(f.actor,new Request("https://example.com"));
    assert.match(cookie,/Max-Age=10800; Secure$/);
    const request = new Request("https://example.com/api/control",{headers:{cookie:cookie.split(";")[0]}});
    now = start + 3*3600000-1;
    assert.deepEqual(await f.auth.requireRecentSession(request),f.actor);
    now++;
    assert.equal(await f.auth.readSession(request),null);
    await assert.rejects(f.auth.requireRecentSession(request),error => error.status === 401);
  } finally { Date.now = originalNow; }
});
