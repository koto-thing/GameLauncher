import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";

// 実装を外部通信だけ差し替えて読み込み、SQLiteで状態遷移を検証する
function loadModule(path, dependencies) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}

// D1のSQLとトランザクションをメモリ内SQLiteで実行する
export async function fixture(t, { role = "assistant" } = {}) {
  const sql = new DatabaseSync(":memory:");
  t.after(() => sql.close());
  const db = {
    prepare(query) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async first() { return sql.prepare(query).get(...values) ?? null; },
        async all() { return { results: sql.prepare(query).all(...values) }; },
        async run() { return { meta: sql.prepare(query).run(...values) }; },
      };
    },
    async batch(statements) {
      sql.exec("BEGIN");
      try {
        const result = [];
        for (const statement of statements) result.push(await statement.run());
        sql.exec("COMMIT");
        return result;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const initialize = loadModule("../../db/initialize.ts", { "cloudflare:workers": { env: { DB: db } } });
  await initialize.ensureSchema();
  const sent = [];
  const dispatch = { enabled: true, fail: false, run: { status: "completed", conclusion: "cancelled", run_attempt: 1 } };
  const policy = loadModule("../../lib/role-policy.ts", {});
  const roles = loadModule("../../lib/roles.ts", { "@/db/initialize": initialize, "@/lib/role-policy": policy });
  const control = loadModule("../../lib/control-plane.ts", {
    "@/db/initialize": initialize,
    "@/lib/roles": roles,
    "@/lib/artifact-limits": { MAX_ARTIFACT_BYTES: 5 * 1024 ** 3, MAX_ARTIFACT_FILES: 50000 },
    "@/lib/github-app": {
      githubAppDispatchConfigured: () => dispatch.enabled,
      deploymentWorkflowRun: async () => dispatch.run,
      dispatchDeploymentWorkflow: async (...args) => {
        if (dispatch.fail) throw new Error("dispatch failed");
        sent.push(args);
      },
    },
  });
  const actions = loadModule("../../lib/actions.ts", {
    "@/db/initialize": initialize,
    "@/lib/control-plane": control,
    "@/lib/intake": { issueArtifactDownloadUrl: async () => "https://example.test/artifact" },
    "@/lib/actions-identity": {},
    "@/lib/roles": roles,
  });
  const actor = { githubUserId: "1", login: "operator", role, isAdmin: role === "admin", gameAccess: role !== "user", authenticatedAt: new Date().toISOString(), authSource: "github" };
  sql.prepare("INSERT INTO users VALUES ('1','operator','',?,?)").run(Number(role === "admin"), new Date().toISOString());
  sql.prepare("INSERT INTO platform_roles VALUES ('1',?,'1','now')").run(role);
  const env = { DB: db, SESSION_SECRET: "test-session-secret-with-32-characters" };
  const auth = loadModule("../../lib/auth.ts", { "cloudflare:workers": { env }, "@/db/initialize": initialize, "@/lib/roles": roles });
  const members = loadModule("../../lib/members.ts", { "@/db/initialize": initialize, "@/lib/roles": roles });
  const security = loadModule("../../lib/request-security.ts", {});
  const memberApi = loadModule("../../app/api/members/route.ts", { "@/lib/auth": auth, "@/lib/members": members, "@/lib/roles": roles, "@/lib/request-security": security });
  const controlApi = loadModule("../../app/api/control/route.ts", { "@/lib/auth": auth, "@/lib/control-plane": control, "@/lib/roles": roles, "@/lib/request-security": security });
  const call = async (api, payload, user = actor) => {
    const cookie = user ? await auth.createSessionCookie(user, new Request("https://admin.test")) : "";
    return api.POST(new Request("https://admin.test/api/control", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://admin.test", cookie: cookie.split(";")[0] }, body: JSON.stringify(payload) }));
  };
  const input = { artifactId: crypto.randomUUID(), gameId: "test-game", version: "1.0.0", artifactSha256: "a".repeat(64), sizeBytes: 10, fileCount: 1 };
  sql.prepare("INSERT INTO artifacts VALUES (?,?,10,1,?,'sealed',?)").run(input.artifactId, "intake/test.zip", input.artifactSha256, new Date().toISOString());
  sql.prepare(`INSERT INTO intake_uploads (artifact_id,intake_object_key,multipart_upload_id,requester_github_user_id,size_bytes,file_count,claimed_sha256,game_id,version,part_size,part_count,state,created_at,expires_at)
    VALUES (?,?,'upload','1',10,1,?,'test-game','1.0.0',10,1,'sealed',?,?)`).run(input.artifactId, "intake/test.zip", input.artifactSha256, new Date().toISOString(), new Date(Date.now() + 86400000).toISOString());
  const state = (id) => sql.prepare("SELECT state FROM deployment_requests WHERE request_id=?").get(id).state;
  const preflight = async (id, environment = "staging") => {
    const attempt = sql.prepare("SELECT attempt_id,github_run_id FROM execution_attempts WHERE request_id=? ORDER BY attempt_number DESC LIMIT 1").get(id);
    return actions.preflightRequest({ deploymentEnvironment: environment, runId: attempt.github_run_id || crypto.randomUUID(), runAttempt: 1, workflowSha: "b".repeat(40), claims: { actor_id: "1", actor: "maintainer" } }, { requestId: id, attemptId: attempt.attempt_id });
  };
  return { sql, db, roles, auth, members, memberApi, controlApi, call, control, actor, input, dispatch, sent, state, preflight };
}
