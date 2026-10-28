import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dispatchOperationsPush, validSubscription, attentionKeys } from "../lib/lt/push.ts";

/**
 * 実SQLと暗号化を使う隔離通知fixtureを作る
 * @param t テストの後処理登録先
 * @returns メモリDB、通知環境と送信記録
 */
async function fixture(t) {
  const sql = new DatabaseSync(":memory:");
  t.after(() => sql.close());
  sql.exec(readFileSync(new URL("../drizzle/0008_lt_push.sql", import.meta.url), "utf8"));
  sql.exec("CREATE TABLE operator_admissions(github_user_id TEXT, version TEXT, revoked_at TEXT); CREATE TABLE platform_roles(github_user_id TEXT,role TEXT); CREATE VIEW active_platform_roles AS SELECT r.* FROM platform_roles r JOIN operator_admissions a USING(github_user_id) WHERE a.revoked_at IS NULL AND r.role IN ('admin','executive','assistant'); INSERT INTO operator_admissions VALUES('1','v1',NULL); INSERT INTO platform_roles VALUES('1','assistant');");
  const db = { prepare(query) { let values = []; return {
    bind(...args) { values = args; return this; },
    async first() { return sql.prepare(query).get(...values) ?? null; },
    async all() { return { results: sql.prepare(query).all(...values) }; },
    async run() { return { meta: sql.prepare(query).run(...values) }; },
  }; } };
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const privateKey = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const publicKey = Buffer.from(await crypto.subtle.exportKey("raw", pair.publicKey)).toString("base64url");
  const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/fixture", keys: { p256dh: publicKey, auth: Buffer.alloc(16, 4).toString("base64url") } };
  const snapshot = { checkedAt: 1000000, maintenance: { status: "ok" }, mail: { mode: "http", configured: true, testRecipientOnly: false, states: [], backlog: { count: 0, oldestAt: null } }, items: [{ key: "withdrawal:a" }] };
  const env = { DB: db, LT_PUSH_PUBLIC_KEY: publicKey, LT_PUSH_PRIVATE_KEY: privateKey.d, LT_INTERNAL: { async operate() { return Response.json(snapshot); } } };
  const sent = [];
  t.mock.method(globalThis, "fetch", async (url, payload) => { sent.push({ url, payload }); return new Response(null, { status: 201 }); });
  const subscribe = () => {
    sql.exec("INSERT OR REPLACE INTO lt_push_preferences VALUES('1',1,'v1')");
    sql.prepare("INSERT INTO lt_push_subscriptions(endpoint,user_id,subscription) VALUES(?,'1',?)").run(subscription.endpoint, JSON.stringify(subscription));
  };
  return { sql, env, subscription, snapshot, sent, subscribe };
}

test("初期無効、明示登録後だけ暗号化配信し、同一要対応は繰り返さない", async t => {
  const f = await fixture(t);
  await dispatchOperationsPush(f.env, 1000000);
  assert.equal(f.sent.length, 0);
  f.subscribe();
  await Promise.all([dispatchOperationsPush(f.env, 1000001), dispatchOperationsPush(f.env, 1000001)]);
  assert.equal(f.sent.length, 1);
  assert.ok(f.sent[0].payload.body.byteLength > 0);
  assert.equal(f.sent[0].payload.redirect, "error");
  await dispatchOperationsPush(f.env, 1400000);
  assert.equal(f.sent.length, 1);
  f.snapshot.items = [];
  await dispatchOperationsPush(f.env, 1800000);
  assert.equal(f.sent.length, 1);
  f.snapshot.items = [{ key: "withdrawal:a" }];
  await dispatchOperationsPush(f.env, 2200000);
  assert.equal(f.sent.length, 2);
});

test("受信停止、権限剥奪と再承認は古い購読を無効化する", async t => {
  const f = await fixture(t);
  for (const change of ["UPDATE lt_push_preferences SET enabled=0", "UPDATE platform_roles SET role='user'", "UPDATE operator_admissions SET version='v2'"]) {
    f.sql.exec("UPDATE platform_roles SET role='assistant'; UPDATE operator_admissions SET version='v1'");
    f.subscribe(); f.sql.exec(change);
    await dispatchOperationsPush(f.env, 1000000);
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM lt_push_subscriptions").get().n, 0);
  }
  assert.equal(f.sent.length, 0);
});

test("一時失敗は遅延再試行し、購読失効は削除する", async t => {
  const f = await fixture(t); f.subscribe();
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 503 }));
  await dispatchOperationsPush(f.env, 1000000);
  assert.equal(f.sql.prepare("SELECT last_error FROM lt_push_subscriptions").get().last_error, 1000000);
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 410 }));
  await dispatchOperationsPush(f.env, 1100000);
  assert.equal(f.sql.prepare("SELECT count(*) AS n FROM lt_push_subscriptions").get().n, 1);
  await dispatchOperationsPush(f.env, 1300001);
  assert.equal(f.sql.prepare("SELECT count(*) AS n FROM lt_push_subscriptions").get().n, 0);
});

test("通知先の内部ネットワーク、認証情報と偽装ホストを拒否する", async t => {
  const f = await fixture(t);
  assert.ok(validSubscription(f.subscription));
  for (const endpoint of ["http://fcm.googleapis.com/x", "https://127.0.0.1/x", "https://fcm.googleapis.com.evil.invalid/x", "https://user@fcm.googleapis.com/x", "https://fcm.googleapis.com:8080/x"]) assert.equal(validSubscription({ ...f.subscription, endpoint }), null);
  assert.deepEqual(attentionKeys({ ...f.snapshot, maintenance: { status: "stale" } }), ["maintenance:stale", "withdrawal:a"]);
});
