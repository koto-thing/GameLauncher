import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { analyticsCsv, analyticsQuery, analyticsResponse, defaultAnalyticsPeriod, parseAnalyticsReport } from "../lib/analytics.ts";

/** @brief APIとCSVの検証に同じ集計契約の値を用いる */
function reportFixture() {
  return {
    schemaVersion: 1,
    period: { ...defaultAnalyticsPeriod(), timeZone: "Asia/Tokyo", environment: "production" },
    lastReceivedAt: new Date().toISOString(),
    games: [{
      gameId: "sample-game", gameVersion: null, versions: ["1.0.0"],
      launchAttempts: 4, successfulLaunches: 3, uniqueDevices: 2,
      totalDurationSeconds: 180, averageDurationSeconds: 60, medianDurationSeconds: 60,
      counts: { running: 0, normal: 1, abnormal: 1, interrupted: 1, launch_failed: 1 },
      durationHistogram: [{ label: "1–5 minutes", minSeconds: 60, maxSeconds: 300, count: 3 }],
      daily: [{ date: defaultAnalyticsPeriod().to, launchAttempts: 4, successfulLaunches: 3, uniqueDevices: 2, durationSeconds: 180 }],
      retention: { nextDay: { eligibleDevices: 2, returnedDevices: 1, rate: 0.5 }, day7: { eligibleDevices: 0, returnedDevices: 0, rate: null } },
      detailAvailable: true,
    }],
  };
}

// 日本時間の日付境界と検索の入力検証は上流に依存しない
test("analytics query uses inclusive JST days and rejects unsafe or invalid filters", () => {
  const now = Date.parse("2026-10-10T15:00:00Z");
  assert.deepEqual(defaultAnalyticsPeriod(now), { from: "2026-09-12", to: "2026-10-11" });
  assert.equal(analyticsQuery(new URLSearchParams(), now).toString(), "from=2026-09-12&to=2026-10-11&environment=production");
  assert.equal(analyticsQuery(new URLSearchParams("from=2026-10-01&to=2026-10-11&environment=staging&gameId=sample-game&gameVersion=1.2.0"), now).get("gameVersion"), "1.2.0");
  for (const query of ["from=2026-02-30", "from=2026-13-01", "to=2026-10-12", "from=2026-10-11&to=2026-10-10", "from=2024-01-01", "environment=other", "gameId=../private", "gameVersion=1.0.0", "from=2026-10-01&from=2026-10-02", "installationId=private"]) {
    assert.throws(() => analyticsQuery(new URLSearchParams(query), now), query);
  }
});

// 無許可の要求はサービスの設定確認や集計取得にも到達しない
test("analytics proxy denies anonymous users and non-admin game collaborators", async () => {
  let calls = 0;
  const binding = { async fetch() { calls += 1; return Response.json(reportFixture()); } };
  const request = new Request("https://admin.example/api/analytics/games");
  for (const [actor, status] of [[null, 401], [{ isAdmin: false, gameAccess: true }, 403], [{ isAdmin: true, gameAccess: false }, 403]]) {
    const response = await analyticsResponse(request, actor, binding, "server-only-test-token");
    assert.equal(response.status, status);
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
  assert.equal(calls, 0);
});

// ブラウザから任意URLを渡せず未知の識別子も受信応答から落とす
test("analytics proxy confines read token to the service binding and strips private fields", async () => {
  const fixture = reportFixture();
  fixture.installationId = "private-installation";
  fixture.games[0].installationIds = ["private-installation"];
  const binding = { async fetch(request) {
    assert.equal(new URL(request.url).origin, "https://platform.internal");
    assert.equal(new URL(request.url).pathname, "/v1/analytics/games");
    assert.equal(request.headers.get("authorization"), "Bearer server-only-test-token");
    assert.equal(request.headers.get("cookie"), null);
    return Response.json(fixture);
  } };
  const response = await analyticsResponse(new Request("https://admin.example/api/analytics/games", { headers: { cookie: "private-session-cookie" } }), { isAdmin: true, gameAccess: true }, binding, "server-only-test-token");
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.doesNotMatch(text, /private-installation|server-only-test-token|private-session-cookie/);
  assert.equal(JSON.parse(text).games[0].successfulLaunches, 3);
});

// 未設定と上流障害を0件の統計と混同しない
test("analytics proxy distinguishes unconfigured service from failed or malformed data", async () => {
  const request = new Request("https://admin.example/api/analytics/games");
  const actor = { isAdmin: true, gameAccess: true };
  assert.equal((await analyticsResponse(request, actor)).status, 503);
  for (const response of [new Response("private upstream failure", { status: 500 }), Response.json({ installationId: "private" }), Response.json({ ...reportFixture(), period: { ...reportFixture().period, environment: "staging" } })]) {
    const result = await analyticsResponse(request, actor, { async fetch() { return response; } }, "server-only-test-token");
    assert.equal(result.status, 502);
    assert.doesNotMatch(await result.text(), /private|server-only-test-token/);
  }
});

// 詳細期限切れと分母0件を保存し率を捏造しない
test("report validation keeps unavailable detail null and rejects impossible retention", () => {
  const fixture = reportFixture();
  const sanitized = parseAnalyticsReport(fixture);
  assert.equal(sanitized.games[0].retention.day7.rate, null);
  fixture.games[0].retention.nextDay.rate = 0.99;
  assert.equal(parseAnalyticsReport(fixture).games[0].retention.nextDay.rate, 0.5);
  fixture.games[0].retention.nextDay.returnedDevices = 3;
  assert.throws(() => parseAnalyticsReport(fixture));
  fixture.games[0].retention.nextDay = { eligibleDevices: null, returnedDevices: null, rate: null };
  fixture.games[0].retention.day7 = { eligibleDevices: null, returnedDevices: null, rate: null };
  fixture.games[0].uniqueDevices = null;
  fixture.games[0].medianDurationSeconds = null;
  fixture.games[0].daily[0].uniqueDevices = null;
  fixture.games[0].detailAvailable = false;
  fixture.lastReceivedAt = null;
  const olderReport = parseAnalyticsReport(fixture);
  const older = olderReport.games[0];
  assert.equal(olderReport.lastReceivedAt, null);
  assert.equal(older.uniqueDevices, null);
  assert.equal(older.medianDurationSeconds, null);
  assert.equal(older.daily[0].uniqueDevices, null);
  assert.deepEqual(older.retention, { nextDay: { eligibleDevices: null, returnedDevices: null, rate: null }, day7: { eligibleDevices: null, returnedDevices: null, rate: null } });
  assert.equal(older.totalDurationSeconds, 180);
  assert.equal(older.detailAvailable, false);
  fixture.games[0].totalDurationSeconds = NaN;
  assert.throws(() => parseAnalyticsReport(fixture));
});

// CSVの集計分母を保持しながら式・引用符・改行をエスケープする
test("CSV exports counts and denominators while neutralizing spreadsheet formulas", () => {
  const report = reportFixture();
  report.games[0].gameVersion = '=HYPERLINK("https://example.com","open")';
  const csv = analyticsCsv(report);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /d1_eligible_installations/);
  assert.match(csv, /tracking_interruption_denominator/);
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example.com"",""open""\)"/);
  assert.match(csv, /"1","3","1","2","0","0"/);
  assert.doesNotMatch(csv, /installationId|installationToken/);
  report.games[0].gameVersion = " @SUM(1,2)";
  assert.match(analyticsCsv(report), /"' @SUM\(1,2\)"/);
});

// 実際のCookie検証を通したAPI入口で匿名・改ざん・権限不足を拒否する
test("analytics route requires a signed, live admin session before calling its service binding", async () => {
  const authSource = (await readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"))
    .replace('import { env } from "cloudflare:workers";', 'const env = { SESSION_SECRET: "analytics-test-secret-with-32-characters" };')
    .replace('import { ensureSchema, getD1 } from "@/db/initialize";', "")
    .replace('import { githubRepositoryAccess } from "@/lib/github-app";', "");
  const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
  const authUrl = `data:text/javascript;base64,${Buffer.from(compile(authSource)).toString("base64")}`;
  const auth = await import(authUrl);
  let calls = 0;
  globalThis.analyticsTestRuntime = { PLATFORM_API: { async fetch() { calls += 1; return Response.json(reportFixture()); } }, ANALYTICS_READ_TOKEN: "server-only-test-token" };
  const routeSource = (await readFile(new URL("../app/api/analytics/games/route.ts", import.meta.url), "utf8"))
    .replace('import { env } from "cloudflare:workers";', "const env = globalThis.analyticsTestRuntime;")
    .replace('from "@/lib/auth"', `from ${JSON.stringify(authUrl)}`)
    .replace('from "@/lib/analytics"', `from ${JSON.stringify(new URL("../lib/analytics.ts", import.meta.url).href)}`);
  const route = await import(`data:text/javascript;base64,${Buffer.from(compile(routeSource)).toString("base64")}`);

  try {
    const request = (cookie) => new Request("https://admin.example/api/analytics/games", { headers: cookie ? { cookie } : {} });
    assert.equal((await route.GET(request())).status, 401);
    assert.equal((await route.GET(request("pandd_deploy_session=forged.signature"))).status, 401);
    const user = { githubUserId: "1", login: "admin", avatarUrl: "", isAdmin: false, gameAccess: true, authenticatedAt: new Date().toISOString(), authSource: "github" };
    const forbiddenCookie = (await auth.createSessionCookie(user, request())).split(";")[0];
    assert.equal((await route.GET(request(forbiddenCookie))).status, 403);
    assert.equal(calls, 0);
    const adminCookie = (await auth.createSessionCookie({ ...user, isAdmin: true }, request())).split(";")[0];
    assert.equal((await route.GET(request(adminCookie))).status, 200);
    assert.equal(calls, 1);
    const stagingRequest = new Request("https://admin.example/api/analytics/games?environment=staging", { headers: { cookie: adminCookie } });
    assert.equal((await route.GET(stagingRequest)).status, 503);
    assert.equal(calls, 1);
    globalThis.analyticsTestRuntime.PLATFORM_API_STAGING = { async fetch(request) {
      assert.equal(request.headers.get("authorization"), "Bearer staging-server-only-test-token");
      return Response.json({ ...reportFixture(), period: { ...reportFixture().period, environment: "staging" } });
    } };
    globalThis.analyticsTestRuntime.ANALYTICS_READ_TOKEN_STAGING = "staging-server-only-test-token";
    assert.equal((await route.GET(stagingRequest)).status, 200);
    assert.equal(calls, 1);
    const expiredCookie = (await auth.createSessionCookie({ ...user, isAdmin: true, authenticatedAt: new Date(Date.now() - 4 * 3600000).toISOString() }, request())).split(";")[0];
    assert.equal((await route.GET(request(expiredCookie))).status, 401);
    assert.equal(calls, 1);
  } finally { delete globalThis.analyticsTestRuntime; }
});
