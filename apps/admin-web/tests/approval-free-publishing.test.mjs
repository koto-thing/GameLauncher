import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./helpers/role-fixture.mjs";

// 新規申請からActions実行前確認までを他者の承認なしで通す
for (const role of ["assistant", "executive", "admin"]) {
  test(`new ${role} request dispatches and passes preflight without approval`, async (t) => {
    const f = await fixture(t, { role });
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
    await assert.rejects(f.control.submitRequest({ ...f.actor, githubUserId: "other" }, { requestId, reason: "" }), (error) => error.status === 403);
    await f.control.submitRequest(f.actor, { requestId, reason: "" });
    assert.equal(f.state(requestId), "dispatched");
    await assert.rejects(f.control.submitRequest(f.actor, { requestId, reason: "" }), /提出できません/);
    assert.equal(f.sent.length, 1);
  });
}

test("revoked requester grant blocks Actions preflight", async (t) => {
  const f = await fixture(t);
  const { requestId } = await f.control.createRequest(f.actor, f.input);
  f.sql.exec("UPDATE platform_roles SET role='user'");
  await assert.rejects(f.preflight(requestId), /現在有効ではありません/);
});

test("assistant publishes valid staging to production without approval", async (t) => {
  const f = await fixture(t);
  const { requestId } = await f.control.createRequest(f.actor, f.input);
  f.sql.prepare("UPDATE deployment_requests SET state='succeeded',production_eligible_until=? WHERE request_id=?").run(new Date(Date.now() + 86400000).toISOString(), requestId);
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

// Staging期限切れはMaintain相当でも実行前に拒否する
 test("expired staging blocks production creation", async (t) => {
  const f = await fixture(t);
  const { requestId } = await f.control.createRequest(f.actor, f.input);
  f.sql.prepare("UPDATE deployment_requests SET state='succeeded',production_eligible_until='2020-01-01T00:00:00Z' WHERE request_id=?").run(requestId);
  await assert.rejects(f.control.createProductionRequest(f.actor, { sourceStagingRequestId: requestId }), /期限を過ぎています/);
});

// Adminは他者の既存申請を実行でき、実行試行ごとに権限を確認する
for (const state of ["ready", "pending_approval"]) {
  test(`admin publishes another user's ${state} request without requester grants`, async (t) => {
    const f = await fixture(t);
    f.dispatch.enabled = false;
    const { requestId } = await f.control.createRequest(f.actor, f.input);
    f.sql.prepare("UPDATE deployment_requests SET state=? WHERE request_id=?").run(state, requestId);
    f.sql.exec("UPDATE platform_roles SET role='user'; INSERT INTO users VALUES ('2','admin','',1,'now'); INSERT INTO platform_roles VALUES ('2','admin','2','now')");
    const admin = { githubUserId: "2", login: "admin", isAdmin: true };
    f.dispatch.enabled = true;
    await f.control.submitRequest(admin, { requestId, reason: "" });
    await f.preflight(requestId);
    assert.equal(f.state(requestId), "running");
    const event = f.sql.prepare("SELECT actor_github_user_id,payload_json FROM audit_events WHERE event_type='workflow_dispatch_requested'").get();
    assert.equal(event.actor_github_user_id, "2");
    assert.equal(JSON.parse(event.payload_json).authority, "admin");
  });
}

test("admin can publish another user's production request while staging conditions remain enforced", async (t) => {
  const f = await fixture(t);
  const source = await f.control.createRequest(f.actor, f.input);
  f.sql.prepare("UPDATE deployment_requests SET state='succeeded',production_eligible_until=? WHERE request_id=?").run(new Date(Date.now() + 86400000).toISOString(), source.requestId);
  f.sql.exec("INSERT INTO users VALUES ('2','admin','',1,'now'); INSERT INTO platform_roles VALUES ('2','admin','2','now')");
  f.dispatch.enabled = false;
  const { requestId } = await f.control.createProductionRequest(f.actor, { sourceStagingRequestId: source.requestId });
  f.dispatch.enabled = true;
  const admin = { githubUserId: "2", login: "admin", isAdmin: true };
  await f.control.dispatchRequest(admin, { requestId });
  f.sql.prepare("UPDATE deployment_requests SET production_eligible_until='2020-01-01T00:00:00Z' WHERE request_id=?").run(source.requestId);
  await assert.rejects(f.preflight(requestId, "production"), /有効なstaging/);
  f.sql.prepare("UPDATE deployment_requests SET production_eligible_until=? WHERE request_id=?").run(new Date(Date.now() + 86400000).toISOString(), source.requestId);
  await f.preflight(requestId, "production");
  assert.equal(f.state(requestId), "running");
});

test("revoked admin privileges cannot authorize a queued execution", async (t) => {
  const f = await fixture(t);
  f.dispatch.enabled = false;
  const { requestId } = await f.control.createRequest(f.actor, f.input);
  f.sql.prepare("UPDATE deployment_requests SET state='ready' WHERE request_id=?").run(requestId);
  f.sql.exec("UPDATE platform_roles SET role='user'; INSERT INTO users VALUES ('2','admin','',1,'now'); INSERT INTO platform_roles VALUES ('2','admin','2','now')");
  f.dispatch.enabled = true;
  await f.control.submitRequest({ githubUserId: "2", login: "admin", isAdmin: true }, { requestId, reason: "" });
  f.sql.exec("UPDATE platform_roles SET role='user' WHERE github_user_id='2'");
  await assert.rejects(f.preflight(requestId), /現在有効ではありません/);
});

// 公開段階に応じてキャンセルからの再試行を制御する
for (const stage of ["preflight", "uploading_immutable", "publishing_pointers", "verifying"]) {
  test(`cancelled Actions at ${stage} respects publication boundary`, async (t) => {
    const f = await fixture(t);
    const { requestId } = await f.control.createRequest(f.actor, f.input);
    await f.preflight(requestId);
    f.sql.prepare("UPDATE execution_attempts SET stage=? WHERE request_id=?").run(stage, requestId);
    await f.control.reconcileCancelledRun(f.actor, { requestId });
    const recovery = ["publishing_pointers", "verifying"].includes(stage);
    assert.equal(f.state(requestId), recovery ? "recovery_required" : "failed_retryable");
    if (recovery) {
      await assert.rejects(f.control.dispatchRequest(f.actor, { requestId }));
    } else {
      await f.control.dispatchRequest(f.actor, { requestId });
      assert.equal(f.sent.length, 2);
      assert.notEqual(f.sent[0][2], f.sent[1][2]);
      assert.equal(f.state(requestId), "dispatched");
    }
  });
}

// 実行中や別の再実行、無権限の操作では状態を変更しない
for (const condition of ["running", "succeeded", "rerun", "unauthorized"]) {
  test(`cancellation reconciliation rejects ${condition}`, async (t) => {
    const f = await fixture(t);
    const { requestId } = await f.control.createRequest(f.actor, f.input);
    await f.preflight(requestId);
    if (condition === "running") f.dispatch.run.status = "in_progress";
    if (condition === "succeeded") f.dispatch.run.conclusion = "success";
    if (condition === "rerun") f.dispatch.run.run_attempt = 2;
    const actor = condition === "unauthorized" ? { ...f.actor, githubUserId: "other" } : f.actor;
    await assert.rejects(f.control.reconcileCancelledRun(actor, { requestId }));
    assert.equal(f.state(requestId), "running");
  });
}
