import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { fixture } from "./helpers/role-fixture.mjs";
import { validSubscription } from "../lib/lt/push.ts";
import { assertBrowserWrite } from "../lib/request-security.ts";

/**
 * 署名セッションと実SQLで通知APIを読み込む
 * @param f 認証・DBの隔離fixture
 * @returns 実際の通知ルート
 */
function route(f) {
  const deps = {
    "cloudflare:workers": { env: { LT_PUSH_PUBLIC_KEY: "fixture", LT_PUSH_PRIVATE_KEY: "fixture" } },
    "@/lib/auth": f.auth,
    "@/db/initialize": { ensureSchema: async () => {}, getD1: () => f.db },
    "@/lib/request-security": { assertBrowserWrite },
    "@/lib/lt/push": { validSubscription },
  };
  const source = readFileSync(new URL("../app/api/lt/notifications/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)(name => { assert.ok(name in deps); return deps[name]; }, exports);
  return exports;
}

test("通知登録は本人認証・Origin・最新権限を要求し、全端末停止は本人だけに作用する", async t => {
  const f = await fixture(t);
  const api = route(f);
  const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/fixture", keys: { p256dh: "B".repeat(87), auth: "B".repeat(22) } };
  const body = { enabled: true, subscription, userId: "forged" };
  assert.equal((await f.call(api, body, null)).status, 401);
  assert.equal((await f.call(api, body)).status, 200);
  assert.deepEqual(f.sql.prepare("SELECT user_id FROM lt_push_preferences").all().map(row => row.user_id), ["1"]);
  const cookie = await f.auth.createSessionCookie(f.actor, new Request("https://admin.test"));
  assert.equal((await api.POST(new Request("https://admin.test/api/lt/notifications", { method: "POST", headers: { cookie, origin: "https://evil.invalid", "Content-Type": "application/json" }, body: JSON.stringify(body) }))).status, 403);
  f.sql.exec("INSERT INTO lt_push_preferences VALUES('other',1,'other'); INSERT INTO lt_push_subscriptions(endpoint,user_id,subscription) VALUES('other','other','{}')");
  assert.equal((await f.call(api, { enabled: false })).status, 200);
  assert.deepEqual(f.sql.prepare("SELECT user_id FROM lt_push_subscriptions").all().map(row => row.user_id), ["other"]);
  f.sql.exec("UPDATE platform_roles SET role='user' WHERE github_user_id='1'");
  assert.equal((await f.call(api, body)).status, 401);
});
