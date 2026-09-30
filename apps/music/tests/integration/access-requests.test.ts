import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync } from "node:crypto";
import { createRuntime, fixtureClient } from "../support/rental-runtime.mjs";

/** @brief 本物のWorkerとD1で申請・審査・認可境界を確認する */
test("access requests bind identity, isolate services and commit grants exactly once", async (t) => {
  const runtime = await createRuntime({ php: { origin: "http://127.0.0.1:1", secret: "a".repeat(64) } });
  t.after(/** @brief テスト用ランタイムを終了する */ () => runtime.dispose());
  const admin = await fixtureClient(runtime, "admin");
  const musicAdmin = await fixtureClient(runtime, "music-admin");
  const applicant = await fixtureClient(runtime, "outsider");
  const collaborator = await fixtureClient(runtime, "maintainer");
  const other = await fixtureClient(runtime, "music-b");
  const anonymous = await fixtureClient(runtime, "");
  const api = "/api/access-requests";
  const submit = { action: "submit", service: "game", displayName: "申請者", purpose: "ゲーム公開を担当します" };
  /** @brief APIへのPOST入力を組み立てる */
  const write = (body: Record<string, unknown>) => ({ method: "POST", body });

  // 匿名・別origin・期限の古い本人確認からは申請できない
  assert.equal((await anonymous.request(api, write(submit))).status, 401);
  assert.equal((await applicant.request(api, { ...write(submit), headers: { Origin: "https://evil.invalid" } })).status, 403);
  const signed = decodeURIComponent(applicant.cookie.split("=")[1]);
  const stale = JSON.parse(Buffer.from(signed.split(".")[0], "base64url").toString());
  stale.user.authenticatedAt = new Date(Date.now() - (3 * 60 + 1) * 60000).toISOString();
  const payload = Buffer.from(JSON.stringify(stale)).toString("base64url");
  const signature = createHmac("sha256", runtime.sessionSecret).update(payload).digest("base64url");
  assert.equal((await applicant.request(api, { ...write(submit), headers: { Cookie: `pandd_deploy_session=${payload}.${signature}` } })).status, 401);
  assert.equal((await applicant.request(api, write({ ...submit, purpose: "x".repeat(1001) }))).status, 400);

  // 本人IDの偽装値は無視し、同時送信でも承認待ちを一つに保つ
  const duplicates = await Promise.all([
    applicant.request(api, write({ ...submit, applicantId: "1001", githubUserId: "1001" })),
    applicant.request(api, write(submit)),
  ]);
  assert.deepEqual(duplicates.map(/** @brief HTTPステータスを取り出す */ (response: Response) => response.status).sort(), [201, 409]);
  const mine = await applicant.json(api);
  const id = mine.requests[0].id;
  assert.equal(mine.requests[0].applicant_id, "900004");
  assert.equal((await other.json(api)).requests.length, 0);
  assert.equal((await other.request(api + "?review=true")).status, 403);
  assert.equal((await applicant.request(api, write({ action: "decide", service: "game", id, decision: "approved", grantType: "requester" }))).status, 403);
  assert.equal((await musicAdmin.request(api, write({ action: "decide", service: "game", id, decision: "approved", grantType: "requester" }))).status, 403);
  assert.equal((await admin.request(api, write({ action: "decide", service: "game", id, decision: "approved", grantType: "requester" }))).status, 409);
  assert.equal((await applicant.json(api)).requests[0].state, "pending");
  assert.equal((await applicant.request("/api/dashboard")).status, 403);

  // 却下理由を要求し、却下後の再申請では審査履歴を残す
  assert.equal((await admin.request(api, write({ action: "decide", service: "game", id, decision: "rejected", reason: "" }))).status, 400);
  await admin.json(api, write({ action: "decide", service: "game", id, decision: "rejected", reason: "担当を確認してください" }));
  await applicant.json(api, write(submit));
  assert.equal((await applicant.json(api)).requests.length, 2);

  // Collaboratorの申請を同時審査しても、勝った審査だけが権限を付与する
  const gameRequest = await collaborator.json(api, write(submit));
  const competing = await Promise.all(["approver", "production_requester"].map(/** @brief 同じ申請を異なる権限で審査する */ (grantType) =>
    admin.request(api, write({ action: "decide", service: "game", id: gameRequest.id, decision: "approved", grantType })),
  ));
  assert.deepEqual(competing.map(/** @brief HTTPステータスを取り出す */ (response: Response) => response.status).sort(), [200, 409]);
  const approved = (await collaborator.json(api)).requests[0];
  const saved = await runtime.db.prepare("SELECT grant_type FROM policy_grants WHERE github_user_id='1002' AND grant_type!='requester'").all();
  assert.deepEqual(saved.results.map(/** @brief 保存された権限を取り出す */ (row: { grant_type: string }) => row.grant_type), [approved.grant_type]);
  assert.equal((await collaborator.request("/api/dashboard")).status, 200);

  // 旧登録経路では未ログインのIDや偽のログイン名からアカウントを作れない
  assert.equal((await admin.request("/api/control", write({ action: "set_grant", githubUserId: "99999", login: "fake", grantType: "requester", enabled: true }))).status, 400);
  const own = await admin.json(api, write(submit));
  assert.equal((await admin.request(api, write({ action: "decide", service: "game", id: own.id, decision: "approved", grantType: "requester" }))).status, 403);

  // Musicの申請は未公開の作品一覧を漏らさず、運営が選んだ作品だけに付与する
  for (const game of ["access-a", "access-b"]) {
    await runtime.db.prepare("INSERT INTO music_games(id,draft,actor,action,updated_at) VALUES(?,?,'900001','create',?)")
      .bind(game, JSON.stringify({ title: game }), Date.now()).run();
  }
  const musicRequest = await applicant.json(api, write({ ...submit, service: "music", target: "作品A" }));
  assert.deepEqual((await applicant.json(api + "?service=music")).games, []);
  assert.equal((await admin.request(api + "?service=music&review=true")).status, 403);
  assert.equal((await musicAdmin.json(api + "?service=music&review=true")).games.length, 2);
  assert.equal((await musicAdmin.request(api, write({ action: "decide", service: "music", id: musicRequest.id, decision: "approved", gameId: "missing" }))).status, 400);
  await musicAdmin.json(api, write({ action: "decide", service: "music", id: musicRequest.id, decision: "approved", gameId: "access-a" }));
  const musicSession = await applicant.json("/session");
  assert.equal((await applicant.json(api + "?service=music")).requests[0].game_title, "access-a");
  assert.deepEqual(musicSession.session.principal.gameIds, ["access-a"]);
  assert.equal(musicSession.session.principal.admin, false);
  assert.equal((await applicant.request("/manage/games/access-b")).status, 403);
  assert.equal((await musicAdmin.request(api, write({ action: "decide", service: "music", id: musicRequest.id, decision: "approved", gameId: "access-b" }))).status, 409);

  // 同じCookieでも担当の取消後は即座にMusic管理を拒否する
  await musicAdmin.json("/admin/games/access-a/members/900004", { method: "PUT", body: { enabled: false } });
  assert.equal((await applicant.json("/session")).session, null);
  assert.equal((await applicant.request("/manage/games")).status, 403);
  assert.equal((await musicAdmin.request("/admin/games/access-a/members/99999", { method: "PUT", body: { enabled: true } })).status, 400);

  // DB後半の失敗で審査結果だけが残らないことを実D1のrollbackで確認する
  const rollback = await other.json(api, write({ ...submit, service: "music", target: "作品B" }));
  await runtime.db.prepare("CREATE TRIGGER fail_access_membership BEFORE INSERT ON music_memberships BEGIN SELECT RAISE(ABORT,'test failure'); END").run();
  assert.equal((await musicAdmin.request(api, write({ action: "decide", service: "music", id: rollback.id, decision: "approved", gameId: "access-b" }))).status, 503);
  assert.equal((await other.json(api + "?service=music")).requests[0].state, "pending");
  await runtime.db.prepare("DROP TRIGGER fail_access_membership").run();

  // ゲーム権限の取消も既存Cookieへ反映する
  for (const grantType of ["requester", approved.grant_type]) {
    await admin.json("/api/control", write({ action: "set_grant", githubUserId: "1002", grantType, enabled: false }));
  }
  assert.notEqual((await collaborator.request("/api/dashboard")).status, 200);
});

/** @brief GitHub境界だけを模擬して名前変更、照会失敗、既存Cookieでの承認反映を確認する */
test("game approval rechecks stable GitHub identity without enabling dispatch", async (t) => {
  const calls: string[] = [];
  let permission = "read";
  let mismatchedIdentity = false;
  let unavailable = false;
  const key = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const runtime = await createRuntime({
    php: { origin: "http://127.0.0.1:1", secret: "a".repeat(64) },
    bindings: { GITHUB_APP_ID: "1", GITHUB_APP_INSTALLATION_ID: "2", GITHUB_APP_PRIVATE_KEY: key },
    /** @brief GitHubの本人照会と権限照会を模擬する */
    github: async (request: Request) => {
      const url = new URL(request.url);
      calls.push(url.pathname);
      assert.equal(url.hostname, "api.github.com");
      if (url.pathname === "/app/installations/2/access_tokens") {
        assert.deepEqual(await request.json(), { repositories: ["GameLauncher"], permissions: { metadata: "read" } });
        return Response.json({ token: "test-installation-token" });
      }
      if (unavailable) return new Response("unavailable", { status: 503 });
      if (url.pathname === "/user/900004") return Response.json({ id: 900004, login: "renamed-applicant" });
      assert.equal(url.pathname, "/repos/koto-thing/GameLauncher/collaborators/renamed-applicant/permission");
      return Response.json({ permission, role_name: permission, user: { id: mismatchedIdentity ? 1234 : 900004 } });
    },
  });
  t.after(/** @brief テスト用ランタイムを終了する */ () => runtime.dispose());
  const admin = await fixtureClient(runtime, "admin");
  const applicant = await fixtureClient(runtime, "outsider");

  /** @brief 署名は本物のままGitHub認証済みのfixtureを用意する */
  function githubCookie(cookie: string): string {
    const signed = decodeURIComponent(cookie.split("=")[1]);
    const session = JSON.parse(Buffer.from(signed.split(".")[0], "base64url").toString());
    session.user.authSource = "github";
    const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
    return `pandd_deploy_session=${payload}.${createHmac("sha256", runtime.sessionSecret).update(payload).digest("base64url")}`;
  }
  const applicantHeaders = { Cookie: githubCookie(applicant.cookie) };
  const id = (await applicant.json("/api/access-requests", { method: "POST", headers: applicantHeaders,
    body: { action: "submit", service: "game", displayName: "担当者", purpose: "公開を担当" } })).id;
  const approve = { method: "POST", headers: { Cookie: githubCookie(admin.cookie) },
    body: { action: "decide", service: "game", id, decision: "approved", grantType: "requester" } };
  assert.equal((await admin.request("/api/access-requests", approve)).status, 409, JSON.stringify(calls));
  permission = "write";
  mismatchedIdentity = true;
  assert.equal((await admin.request("/api/access-requests", approve)).status, 409, JSON.stringify(calls));
  mismatchedIdentity = false;
  unavailable = true;
  assert.equal((await admin.request("/api/access-requests", approve)).status, 503);
  assert.equal((await applicant.json("/api/access-requests", { headers: applicantHeaders })).requests[0].state, "pending");
  unavailable = false;
  await admin.json("/api/access-requests", approve);
  assert.equal((await applicant.request("/api/dashboard", { headers: applicantHeaders })).status, 200);
  unavailable = true;
  assert.equal((await applicant.request("/api/dashboard", { headers: applicantHeaders })).status, 403);
  assert.equal((await applicant.json("/api/access-requests", { headers: applicantHeaders })).user.login, "outsider");
});
