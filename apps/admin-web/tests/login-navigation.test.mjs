import assert from "node:assert/strict";
import test from "node:test";
import { safeReturnTo, loginUrl, isManagementPage } from "../lib/login-navigation.ts";
import { fixture } from "./helpers/role-fixture.mjs";

// 外部URL、認証ループ、URL正規化による迂回を拒否する
test("return destinations stay on management pages", () => {
  for (const value of [null, "https://evil.test", "//evil.test", "/\\evil.test", "/login", "/api/auth/logout", "/game/../login", "/\nevil.test"]) {
    assert.equal(safeReturnTo(value), "/");
  }
  assert.equal(safeReturnTo("/intake?mode=build#images"), "/intake?mode=build#images");
  assert.equal(new URL(loginUrl("/game?view=recent"), "https://admin.test").searchParams.get("returnTo"), "/game?view=recent");
  assert.equal(isManagementPage("/game/child"), true);
  for (const path of ["/login", "/api/dashboard", "/invitations", "/favicon.png", "/_next/static/file.js", "/music-editor/manager.js"]) {
    assert.equal(isManagementPage(path), false);
  }
});

// 戻り先はPKCEと同じ署名付きstateに保存し、改ざん・期限切れを拒否する
test("OAuth carries a signed return destination and validates state expiry", async t => {
  const f = await fixture(t);
  Object.assign(f.env, { GITHUB_CLIENT_ID: "test", GITHUB_CLIENT_SECRET: "test", GITHUB_CALLBACK_URL: "https://admin.test/api/auth/github/callback" });
  const flow = await f.auth.beginGithubFlow(new Request("https://admin.test/api/auth/github/start?returnTo=%2Fintake%3Fmode%3Dbuild"));
  const state = new URL(flow.url).searchParams.get("state");
  const request = new Request("https://admin.test/api/auth/github/callback", { headers: { cookie: flow.cookie.split(";")[0] } });
  const verified = await f.auth.githubFlowVerifier(request, state);
  assert.equal(verified.returnTo, "/intake?mode=build");
  assert.ok(verified.verifier.length >= 43);
  assert.equal(await f.auth.githubFlowVerifier(request, "wrong-state"), null);
  const tampered = new Request(request.url, { headers: { cookie: flow.cookie.split(";")[0] + "x" } });
  assert.equal(await f.auth.githubFlowVerifier(tampered, state), null);
  const now = Date.now();
  t.mock.method(Date, "now", () => now + 601000);
  assert.equal(await f.auth.githubFlowVerifier(request, state), null);
});
