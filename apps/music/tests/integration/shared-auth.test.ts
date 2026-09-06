import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { createRuntime, fixtureClient } from "../support/rental-runtime.mjs";

test("shared GitHub identity, strict game authorization, PKCE and cookie boundaries", /** @brief GitHub境界だけを模擬し本物の認証関数・D1・Callbackを実行する。 */ async (t) => {
  let permission = "none";
  let userId = 900002;
  let identityFails = false;
  let tokenRequest: Record<string, string> = {};
  const runtime = await createRuntime({
    github: /** @brief 外部GitHub応答を限定し本番通信を行わない。 */ async (
      request: Request,
    ) => {
      const url = new URL(request.url);
      assert.ok(["api.github.com", "github.com"].includes(url.hostname));
      if (url.pathname === "/login/oauth/access_token") {
        tokenRequest = (await request.json()) as Record<string, string>;
        return Response.json({ access_token: "test-token" });
      }
      if (url.pathname === "/user")
        return identityFails
          ? new Response("unauthorized", { status: 401 })
          : Response.json({ id: userId, login: "music-a", avatar_url: "" });
      if (url.pathname.endsWith("/permission"))
        return Response.json({ permission, role_name: permission });
      return permission === "none"
        ? new Response("unavailable", { status: 404 })
        : Response.json({ owner: { id: 1001 } });
    },
  });
  t.after(/** @brief 所有する隔離環境を停止する。 */ () => runtime.dispose());
  const url = runtime.origin;
  /** @brief 同じWorkerへ認証APIを送る。 @param path API。 @param cookie Cookie。 @returns 応答。 */
  const get = (path: string, cookie = "") =>
    runtime.dispatchFetch(url + path, {
      headers: { Cookie: cookie },
      redirect: "manual",
    });
  assert.equal(
    ((await (await get("/__test/identity")).json()) as { gameAccess: boolean })
      .gameAccess,
    false,
  );
  assert.equal((await get("/__test/identity?game")).status, 403);
  for (permission of ["read", "triage"])
    assert.equal((await get("/__test/identity?game")).status, 403);
  for (permission of ["write", "maintain", "admin"])
    assert.equal(
      (
        (await (await get("/__test/identity?game")).json()) as {
          gameAccess: boolean;
        }
      ).gameAccess,
      true,
    );
  permission = "read";
  userId = 1001;
  assert.equal(
    (
      (await (await get("/__test/identity?game")).json()) as {
        isAdmin: boolean;
      }
    ).isAdmin,
    true,
  );
  identityFails = true;
  assert.equal((await get("/__test/identity")).status, 403);
  identityFails = false;
  userId = 900002;
  permission = "none";
  const start = await get("/api/auth/github/start");
  assert.equal(start.status, 302);
  const authorize = new URL(start.headers.get("location")!);
  const cookie = start.headers.get("set-cookie")!.split(";")[0];
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  assert.equal(
    authorize.searchParams.get("redirect_uri"),
    `${url}/api/auth/github/callback`,
  );
  assert.equal(
    (await get("/api/auth/github/callback?code=test&state=wrong", cookie))
      .status,
    400,
  );
  assert.equal(
    (
      await get(
        `/api/auth/github/callback?code=test&state=${authorize.searchParams.get("state")}`,
        cookie + "tamper",
      )
    ).status,
    400,
  );
  const callback = await get(
    `/api/auth/github/callback?code=test&state=${authorize.searchParams.get("state")}`,
    cookie,
  );
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get("location"), "/music");
  assert.equal(
    createHash("sha256").update(tokenRequest.code_verifier).digest("base64url"),
    authorize.searchParams.get("code_challenge"),
  );
  assert.match(callback.headers.get("set-cookie")!, /Max-Age=0/);
  const client = await fixtureClient(runtime, "music-a");
  assert.deepEqual(await client.json("/api/auth/services"), {
    game: false,
    music: false,
  });
  assert.deepEqual(
    await (
      await fixtureClient(runtime, "music-admin")
    ).json("/api/auth/services"),
    { game: false, music: true },
  );
  assert.equal(
    (
      await runtime.dispatchFetch(
        "https://production.invalid/api/auth/dev?as=admin",
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await runtime.dispatchFetch("https://production.invalid/api/dashboard", {
        headers: { Cookie: client.cookie },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      (await (
        await runtime.dispatchFetch(
          "https://production.invalid/api/dashboard",
          { headers: { Cookie: client.cookie } },
        )
      ).json()) as { authenticated: boolean }
    ).authenticated,
    false,
  );
  const session = JSON.parse(
    Buffer.from(
      decodeURIComponent(client.cookie.split("=")[1]).split(".")[0],
      "base64url",
    ).toString(),
  );
  /** @brief 古い形・期限切れの正しく署名したCookieを試験する。 @param value Cookie内容。 @returns 署名Cookie。 */
  function signed(value: unknown): string {
    const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
    return `pandd_deploy_session=${payload}.${createHmac("sha256", runtime.sessionSecret).update(payload).digest("base64url")}`;
  }
  session.expiresAt = 1;
  assert.equal(
    (
      (await (await get("/api/music/session", signed(session))).json()) as {
        session: unknown;
      }
    ).session,
    null,
  );
  session.expiresAt = Date.now() + 60000;
  delete session.user.gameAccess;
  assert.equal(
    (
      (await (await get("/api/music/session", signed(session))).json()) as {
        session: unknown;
      }
    ).session,
    null,
  );
  assert.equal(
    (
      (await (
        await get("/api/music/session", "pandd_deploy_session=%ZZ")
      ).json()) as { session: unknown }
    ).session,
    null,
  );
  assert.equal(
    (await client.request("/api/auth/logout", { method: "POST", body: {} }))
      .status,
    204,
  );
});
