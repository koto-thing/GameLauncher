import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
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
async function fixture(t, { admin = false, requester = true, production = false } = {}) {
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
  const initialize = loadModule("../db/initialize.ts", { "cloudflare:workers": { env: { DB: db } } });
  await initialize.ensureSchema();
  const sent = [];
  const dispatch = { enabled: true, fail: false };
  const control = loadModule("../lib/control-plane.ts", {
    "@/db/initialize": initialize,
    "@/lib/access-requests": {},
    "@/lib/artifact-limits": { MAX_ARTIFACT_BYTES: 5 * 1024 ** 3, MAX_ARTIFACT_FILES: 50000 },
    "@/lib/github-app": {
      githubAppDispatchConfigured: () => dispatch.enabled,
      dispatchDeploymentWorkflow: async (...args) => {
        if (dispatch.fail) throw new Error("dispatch failed");
        sent.push(args);
      },
    },
  });
  const actions = loadModule("../lib/actions.ts", {
    "@/db/initialize": initialize,
    "@/lib/control-plane": control,
    "@/lib/intake": { issueArtifactDownloadUrl: async () => "https://example.test/artifact" },
    "@/lib/actions-identity": {},
  });
  const actor = { githubUserId: "1", login: "maintainer", isAdmin: admin };
  sql.prepare("INSERT INTO users VALUES ('1','maintainer','',?,?)").run(Number(admin), new Date().toISOString());
  for (const grant of [...(requester ? ["requester"] : []), ...(production ? ["production_requester"] : [])]) {
    sql.prepare("INSERT INTO policy_grants VALUES ('1',?,'1',?,NULL)").run(grant, new Date().toISOString());
  }
  const input = { artifactId: crypto.randomUUID(), gameId: "test-game", version: "1.0.0", artifactSha256: "a".repeat(64), sizeBytes: 10, fileCount: 1 };
  sql.prepare("INSERT INTO artifacts VALUES (?,?,10,1,?,'sealed',?)").run(input.artifactId, "intake/test.zip", input.artifactSha256, new Date().toISOString());
  sql.prepare(`INSERT INTO intake_uploads (artifact_id,intake_object_key,multipart_upload_id,requester_github_user_id,size_bytes,file_count,claimed_sha256,game_id,version,part_size,part_count,state,created_at,expires_at)
    VALUES (?,?,'upload','1',10,1,?,'test-game','1.0.0',10,1,'sealed',?,?)`).run(input.artifactId, "intake/test.zip", input.artifactSha256, new Date().toISOString(), new Date(Date.now() + 86400000).toISOString());
  const state = (id) => sql.prepare("SELECT state FROM deployment_requests WHERE request_id=?").get(id).state;
  const preflight = async (id, environment = "staging") => {
    const attempt = sql.prepare("SELECT attempt_id FROM execution_attempts WHERE request_id=? ORDER BY attempt_number DESC LIMIT 1").get(id);
    return actions.preflightRequest({ deploymentEnvironment: environment, runId: crypto.randomUUID(), runAttempt: 1, workflowSha: "b".repeat(40), claims: { actor_id: "1", actor: "maintainer" } }, { requestId: id, attemptId: attempt.attempt_id });
  };
  return { sql, control, actor, input, dispatch, sent, state, preflight };
}

// 新規申請からActions実行前確認までを他者の承認なしで通す
for (const admin of [false, true]) {
  test(`new ${admin ? "admin" : "maintainer"} request dispatches and passes preflight without approval`, async (t) => {
    const f = await fixture(t, { admin, requester: !admin });
    const result = await f.control.createRequest(f.actor, f.input);
    assert.equal(result.dispatchError, undefined);
    assert.equal(f.state(result.requestId), "dispatched");
    assert.equal(f.sent.length, 1);
    await f.preflight(result.requestId);
    assert.equal(f.state(result.requestId), "running");
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS count FROM approval_decisions").get().count, 0);
  });
}

// 既存申請は同じIDを使い、準備中と承認待ちから直接実行できる
for (const state of ["ready", "pending_approval"]) {
  test(`existing ${state} request can publish once without approvers`, async (t) => {
    const f = await fixture(t);
    f.dispatch.enabled = false;
    const { requestId } = await f.control.createRequest(f.actor, f.input);
    f.sql.prepare("UPDATE deployment_requests SET state=? WHERE request_id=?").run(state, requestId);
    f.dispatch.enabled = true;
    await assert.rejects(f.control.submitRequest({ ...f.actor, githubUserId: "other" }, { requestId, reason: "" }), /申請者本人/);
    await f.control.submitRequest(f.actor, { requestId, reason: "" });
    assert.equal(f.state(requestId), "dispatched");
    await assert.rejects(f.control.submitRequest(f.actor, { requestId, reason: "" }), /提出できません/);
    assert.equal(f.sent.length, 1);
  });
}

test("revoked requester grant blocks Actions preflight", async (t) => {
  const f = await fixture(t);
  const { requestId } = await f.control.createRequest(f.actor, f.input);
  f.sql.exec("UPDATE policy_grants SET revoked_at='revoked'");
  await assert.rejects(f.preflight(requestId), /現在有効ではありません/);
});

test("production requires its own grant and valid staging, then dispatches without approval", async (t) => {
  const f = await fixture(t);
  const { requestId } = await f.control.createRequest(f.actor, f.input);
  f.sql.prepare("UPDATE deployment_requests SET state='succeeded',production_eligible_until=? WHERE request_id=?").run(new Date(Date.now() + 86400000).toISOString(), requestId);
  await assert.rejects(f.control.createProductionRequest(f.actor, { sourceStagingRequestId: requestId }), /Production申請者/);
  f.sql.exec("INSERT INTO policy_grants VALUES ('1','production_requester','1','now',NULL)");
  const result = await f.control.createProductionRequest(f.actor, { sourceStagingRequestId: requestId });
  assert.equal(result.dispatchError, undefined);
  await f.preflight(result.requestId, "production");
  assert.equal(f.state(result.requestId), "running");
});

test("failed dispatch preserves the request for retry", async (t) => {
  const f = await fixture(t);
  f.dispatch.fail = true;
  const result = await f.control.createRequest(f.actor, f.input);
  assert.match(result.dispatchError, /dispatch failed/);
  assert.equal(f.state(result.requestId), "failed_retryable");
  f.dispatch.fail = false;
  await f.control.dispatchRequest(f.actor, result);
  assert.equal(f.state(result.requestId), "dispatched");
});

// Production専用の申請者はMaintain相当ではないため指名承認を必要とする
 test("production-only requester still needs an independent designated approval", async (t) => {
  const f = await fixture(t, { production: true });
  const { requestId } = await f.control.createRequest(f.actor, f.input);
  f.sql.prepare("UPDATE deployment_requests SET state='succeeded',production_eligible_until=? WHERE request_id=?").run(new Date(Date.now() + 86400000).toISOString(), requestId);
  f.sql.exec("DELETE FROM policy_grants WHERE grant_type='requester'");
  const result = await f.control.createProductionRequest(f.actor, { sourceStagingRequestId: requestId });
  assert.equal(f.state(result.requestId), "ready");
  await assert.rejects(f.control.submitRequest(f.actor, { requestId: result.requestId, reason: "" }), /承認者指名/);
  f.sql.prepare("UPDATE deployment_requests SET state='approved' WHERE request_id=?").run(result.requestId);
  await f.control.dispatchRequest(f.actor, result);
  await assert.rejects(f.preflight(result.requestId, "production"), /有効な指名承認/);
});

// Staging期限切れはMaintain相当でも実行前に拒否する
 test("expired staging blocks production creation", async (t) => {
  const f = await fixture(t, { production: true });
  const { requestId } = await f.control.createRequest(f.actor, f.input);
  f.sql.prepare("UPDATE deployment_requests SET state='succeeded',production_eligible_until='2020-01-01T00:00:00Z' WHERE request_id=?").run(requestId);
  await assert.rejects(f.control.createProductionRequest(f.actor, { sourceStagingRequestId: requestId }), /期限を過ぎています/);
});
