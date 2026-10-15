import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./helpers/role-fixture.mjs";

// 実SQLと実HTTPハンドラーを使い、UIを経由しない改ざん・拒否も検証する
function addUser(f, id, role = "user") {
  f.sql.prepare("INSERT INTO users VALUES (?,?,'',0,'now')").run(id, `user-${id}`);
  f.sql.prepare("INSERT INTO platform_roles VALUES (?,?,'1','now')").run(id, role);
  f.sql.prepare("INSERT INTO operator_admissions VALUES (?,?,?,NULL)").run(id,`user-${id}`,`fixture-${id}`);
  return { ...f.actor, githubUserId: id, login:`user-${id}`, admissionVersion:`fixture-${id}`, role, isAdmin: role === "admin" };
}

for (const mode of ["rollback", "suspend", "resume"]) {
  test(`assistant ${mode} pins the successful production manifest and rejects unverified versions`, async (t) => {
    const f = await fixture(t);
    const source = await f.control.createRequest(f.actor,f.input);
    f.sql.prepare("UPDATE deployment_requests SET state='succeeded',production_eligible_until=? WHERE request_id=?").run(new Date(Date.now()+86400000).toISOString(),source.requestId);
    const production = await f.control.createProductionRequest(f.actor,{sourceStagingRequestId:source.requestId});
    const input = { requestId:production.requestId,mode,reason:"Verified successful release restored during incident" };
    await assert.rejects(f.control.recoverPublication(f.actor,input),e=>e.status===409);
    f.sql.prepare("UPDATE deployment_requests SET state='succeeded' WHERE request_id=?").run(production.requestId);
    await assert.rejects(f.control.recoverPublication(f.actor,input),e=>e.status===409);
    const record = await f.control.auditRecord(production.requestId,"execution_finished",f.actor,{result:"succeeded",manifestSha256:"d".repeat(64)});
    await record.run();
    f.sql.prepare("UPDATE deployment_requests SET production_eligible_until='2000-01-01' WHERE request_id=?").run(source.requestId);
    await f.control.recoverPublication(f.actor,input);
    const snapshot = await f.preflight(production.requestId,"production");
    assert.deepEqual({ ...snapshot.recovery },{mode,manifestSha256:"d".repeat(64)});
    assert.equal(f.state(production.requestId),"running");
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM approval_decisions").get().n,0);
    await assert.rejects(f.control.recoverPublication(f.actor,input),e=>e.status===409);
  });
}

test("recovery refuses another active publication of the same game without changing the successful request", async (t) => {
  const f = await fixture(t);
  const source = await f.control.createRequest(f.actor,f.input);
  f.sql.prepare("UPDATE deployment_requests SET state='succeeded',production_eligible_until=? WHERE request_id=?").run(new Date(Date.now()+86400000).toISOString(),source.requestId);
  const production = await f.control.createProductionRequest(f.actor,{sourceStagingRequestId:source.requestId});
  f.sql.prepare("UPDATE deployment_requests SET state='succeeded' WHERE request_id=?").run(production.requestId);
  await (await f.control.auditRecord(production.requestId,"execution_finished",f.actor,{result:"succeeded",manifestSha256:"d".repeat(64)})).run();
  f.sql.prepare("UPDATE deployment_requests SET version='2.0.0' WHERE request_id=?").run(source.requestId);
  const competing = await f.control.createProductionRequest(f.actor,{sourceStagingRequestId:source.requestId});
  for (const state of ["dispatched","running","publishing_pointers","verifying"]) {
    f.sql.prepare("UPDATE deployment_requests SET state=? WHERE request_id=?").run(state,competing.requestId);
    await assert.rejects(f.control.recoverPublication(f.actor,{requestId:production.requestId,mode:"rollback",reason:"Restore verified version during incident"}),e=>e.status===409);
    assert.equal(f.state(production.requestId),"succeeded");
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM publication_recoveries").get().n,0);
  }
});

for (const role of ["user", "assistant", "executive"]) {
  test(`${role} cannot change roles or perform dangerous operations`, async (t) => {
    const f = await fixture(t, { role });
    addUser(f,"2");
    const response = await f.call(f.memberApi,{ action: "set_role", githubUserId: "2", role: "admin" });
    assert.equal(response.status,role === "user" ? 401 : 403);
    await assert.rejects(f.roles.requirePermission(f.actor,"dangerous"), (e) => e.status === 403);
    assert.equal(await f.roles.currentRole("2"),null);
    assert.ok(f.sql.prepare("SELECT 1 FROM operation_events WHERE result LIKE 'rejected:%'").get());
  });
}

test("unauthenticated and general users cannot call publishing APIs; old grants do not elevate", async (t) => {
  const f = await fixture(t, { role: "user" });
  for (const action of ["create_request","create_production_request","authorize_recovery","dispatch_request","reconcile_cancelled_run"]) {
    assert.equal((await f.call(f.controlApi,{ action },null)).status,401);
    assert.equal((await f.call(f.controlApi,{ action })).status,401);
  }
  f.sql.exec("UPDATE users SET is_admin=1; INSERT INTO policy_grants VALUES ('1','requester','1','now',NULL)");
  assert.equal((await f.call(f.controlApi,{ action: "create_request",...f.input })).status,401);
  assert.equal((await f.call(f.memberApi,{ action: "invite",githubUserId: "2",role: "assistant" })).status,401);
});

test("unknown roles and stale signed admin cookies fail closed", async (t) => {
  const f = await fixture(t, { role: "admin" });
  f.sql.exec("PRAGMA ignore_check_constraints=ON; UPDATE platform_roles SET role='superadmin'");
  const cookie = await f.auth.createSessionCookie(f.actor,new Request("https://admin.test"));
  const session = await f.auth.readSession(new Request("https://admin.test",{headers:{cookie}}));
  assert.equal(session,null);
  assert.equal((await f.call(f.controlApi,{ action: "create_request",...f.input })).status,401);
});

for (const role of ["assistant","executive","admin"]) {
  test(`${role} recovers another operator's game without approval`, async (t) => {
    const f = await fixture(t);
    const actor = addUser(f,"2",role);
    const { requestId } = await f.control.createRequest(f.actor,f.input);
    f.sql.prepare("UPDATE deployment_requests SET state='recovery_required' WHERE request_id=?").run(requestId);
    assert.equal((await f.call(f.controlApi,{action:"authorize_recovery",requestId,reason:"R2 immutable objects and pointers verified"},actor)).status,200);
    assert.equal((await f.call(f.controlApi,{action:"dispatch_request",requestId},actor)).status,200);
    await f.preflight(requestId);
    assert.equal(f.state(requestId),"running");
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM approval_decisions").get().n,0);
    assert.equal(f.sql.prepare("SELECT actor_github_user_id FROM audit_events WHERE event_type='recovery_retry_authorized'").get().actor_github_user_id,"2");
    f.sql.prepare("UPDATE platform_roles SET role='user' WHERE github_user_id='2'").run();
    await assert.rejects(f.preflight(requestId),/現在有効ではありません/);
  });
}
