import test from "node:test";
import assert from "node:assert/strict";
import { AuthService } from "../../src/application/auth-service.ts";
import { D1AuthStore } from "../../src/infrastructure/auth/d1-auth-store.ts";
import {
  equalToken,
  hashToken,
  randomToken,
} from "../../src/infrastructure/auth/crypto.ts";
import { createRuntime } from "../support/runtime.mjs";

test("OAuth state PKCE single-use session expiry and explicit administrator bootstrap", /** @brief GitHub通信境界だけを差し替えて実D1で認証の状態遷移を検証する。 */ async (t) => {
  const runtime = await createRuntime({ production: true });
  t.after(
    /** @brief 認証DBを隔離して閉じる。 */ async () => {
      await runtime.dispose();
    },
  );
  const db = await runtime.getD1Database("MUSIC_DB");
  const store = new D1AuthStore(db);
  let now = Date.now();
  let verifier = "";
  let identityId = "12345";
  const policy = {
    origin: "https://music.example",
    githubClientId: "test-client",
    configured: true,
    bootstrapAdminIds: ["12345"],
    sessionSeconds: 3600,
    flowSeconds: 600,
  };
  const provider = {
    /** @brief プロバイダー交換の引数だけを記録し外部ネットワークを不要にする。 */ async exchange(
      _code: string,
      codeVerifier: string,
    ) {
      verifier = codeVerifier;
      return { id: identityId, login: "same-visible-name" };
    },
  };
  const auth = new AuthService(
    store,
    provider,
    { random: randomToken, hash: hashToken, equal: equalToken },
    { /** @brief 有効期限境界を再現する仮想時刻。 */ now: () => now },
    policy,
  );
  const flow = await auth.begin();
  const url = new URL(flow.url);
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "https://music.example/api/auth/callback",
  );
  assert.equal(url.searchParams.get("scope"), "");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge")!.length, 43);
  await assert.rejects(
    /** @brief state Cookieが一致しないCallbackを拒否する。 */ () =>
      auth.complete("code", flow.state, "attacker"),
  );
  const results = await Promise.allSettled([
    auth.complete("code", flow.state, flow.state),
    auth.complete("code", flow.state, flow.state),
  ]);
  assert.equal(
    results.filter(
      /** @brief Callbackの同時再送も1回だけ成功させる。 */ (item) =>
        item.status === "fulfilled",
    ).length,
    1,
  );
  assert.equal(
    await hashToken(verifier),
    url.searchParams.get("code_challenge"),
  );
  const issued = results.find(
    /** @brief 成功したセッションを取得する。 */ (item) =>
      item.status === "fulfilled",
  );
  assert.ok(issued?.status === "fulfilled");
  const session = await auth.session(issued.value.token);
  assert.equal(session?.principal.id, "12345");
  assert.equal(session?.principal.admin, true);
  const stored = await db
    .prepare("SELECT token_hash FROM sessions")
    .first<{ token_hash: string }>();
  assert.notEqual(stored?.token_hash, issued.value.token);
  // 古いセッションが残っていても、現在のロールを毎回再取得する。
  await db
    .prepare("UPDATE accounts SET admin=0 WHERE id=?")
    .bind("12345")
    .run();
  assert.equal(
    (await auth.session(issued.value.token))?.principal.admin,
    false,
  );
  const relogin = await auth.begin();
  await auth.complete("another-code", relogin.state, relogin.state);
  assert.equal(
    (await auth.session(issued.value.token))?.principal.admin,
    false,
  );
  identityId = "99999";
  const outsider = await auth.begin();
  const unassigned = await auth.complete(
    "code",
    outsider.state,
    outsider.state,
  );
  assert.equal((await auth.session(unassigned.token))?.principal.admin, false);
  now += 3600 * 1000 + 1;
  assert.equal(await auth.session(issued.value.token), null);
  const expiredFlow = await auth.begin();
  now += 600 * 1000 + 1;
  await assert.rejects(
    /** @brief 認証途中状態の期限も検証する。 */ () =>
      auth.complete("code", expiredFlow.state, expiredFlow.state),
  );
});
