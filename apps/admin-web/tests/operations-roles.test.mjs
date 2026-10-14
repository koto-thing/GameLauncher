import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./helpers/role-fixture.mjs";

// 実SQLと実HTTPハンドラーを使い、UIを経由しない改ざん・拒否も検証する
function addUser(f, id, role = "user") {
  f.sql.prepare("INSERT INTO users VALUES (?,?,'',0,'now')").run(id, `user-${id}`);
  f.sql.prepare("INSERT INTO platform_roles VALUES (?,?,'1','now')").run(id, role);
  return { ...f.actor, githubUserId: id, role, isAdmin: role === "admin" };
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
    assert.equal(response.status,403);
    await assert.rejects(f.roles.requirePermission(f.actor,"dangerous"), (e) => e.status === 403);
    assert.equal(await f.roles.currentRole("2"),"user");
    assert.ok(f.sql.prepare("SELECT 1 FROM operation_events WHERE actor='1' AND result LIKE 'rejected:%'").get());
  });
}

test("unauthenticated and general users cannot call publishing APIs; old grants do not elevate", async (t) => {
  const f = await fixture(t, { role: "user" });
  for (const action of ["create_request","create_production_request","authorize_recovery","dispatch_request","reconcile_cancelled_run"]) {
    assert.equal((await f.call(f.controlApi,{ action },null)).status,401);
    assert.equal((await f.call(f.controlApi,{ action })).status,403);
  }
  f.sql.exec("UPDATE users SET is_admin=1; INSERT INTO policy_grants VALUES ('1','requester','1','now',NULL)");
  assert.equal((await f.call(f.controlApi,{ action: "create_request",...f.input })).status,403);
  assert.equal((await f.call(f.memberApi,{ action: "invite",githubUserId: "2",role: "assistant" })).status,403);
});

test("unknown roles and stale signed admin cookies fail closed", async (t) => {
  const f = await fixture(t, { role: "admin" });
  f.sql.exec("PRAGMA ignore_check_constraints=ON; UPDATE platform_roles SET role='superadmin'");
  const cookie = await f.auth.createSessionCookie(f.actor,new Request("https://admin.test"));
  const session = await f.auth.readSession(new Request("https://admin.test",{headers:{cookie}}));
  assert.equal(session.role,"user");
  assert.equal(session.gameAccess,false);
  assert.equal(session.isAdmin,false);
  assert.equal((await f.call(f.controlApi,{ action: "create_request",...f.input })).status,403);
});

test("executive invitation is recipient-bound, assistant-only, one-time, and role input cannot override it", async (t) => {
  const f = await fixture(t, { role: "executive" });
  const recipient = addUser(f,"2");
  const other = addUser(f,"3");
  for (const role of ["executive","admin","unknown"]) {
    assert.ok((await f.call(f.memberApi,{action:"invite",githubUserId:"2",role})).status >= 400);
  }
  assert.equal((await f.call(f.memberApi,{ action:"invite",githubUserId:"3",role:"assistant" }, { ...recipient, role:"admin",isAdmin:true })).status,403);
  const invitation = await (await f.call(f.memberApi,{action:"invite",githubUserId:"2",role:"assistant"})).json();
  assert.equal((await f.call(f.memberApi,{action:"accept",id:invitation.id},other)).status,409);
  assert.equal((await f.call(f.memberApi,{action:"accept",id:invitation.id,role:"admin"},recipient)).status,400);
  assert.equal((await f.call(f.memberApi,{action:"accept",id:invitation.id},recipient)).status,200);
  assert.equal(await f.roles.currentRole("2"),"assistant");
  assert.equal((await f.call(f.memberApi,{action:"accept",id:invitation.id},recipient)).status,409);
  assert.equal((await f.call(f.memberApi,{action:"invite",githubUserId:"2",role:"assistant"})).status,409);
});

test("tampered invitation, revoked issuer, and expiry cannot grant elevated roles", async (t) => {
  const f = await fixture(t,{role:"executive"});
  const recipient = addUser(f,"2");
  const { id } = await f.members.inviteMember(f.actor,{githubUserId:"2",role:"assistant"});
  f.sql.prepare("UPDATE member_invitations SET role='executive' WHERE id=?").run(id);
  assert.equal((await f.call(f.memberApi,{action:"accept",id},recipient)).status,409);
  f.sql.prepare("UPDATE member_invitations SET role='assistant' WHERE id=?").run(id);
  f.sql.exec("UPDATE platform_roles SET role='assistant' WHERE github_user_id='1'");
  assert.equal((await f.call(f.memberApi,{action:"accept",id},recipient)).status,409);
  f.sql.exec("UPDATE platform_roles SET role='executive' WHERE github_user_id='1'; UPDATE member_invitations SET expires_at='2000-01-01'");
  assert.equal((await f.call(f.memberApi,{action:"accept",id},recipient)).status,409);
  assert.equal(await f.roles.currentRole("2"),"user");
});

test("Admin invites executives, promotes Admin, and cannot remove the last Admin", async (t) => {
  const f = await fixture(t,{role:"admin"});
  const recipient = addUser(f,"2");
  const { id } = await f.members.inviteMember(f.actor,{githubUserId:"2",role:"executive"});
  await f.members.acceptInvitation(recipient,{id});
  assert.equal(await f.roles.currentRole("2"),"executive");
  await assert.rejects(f.members.changeRole(f.actor,{githubUserId:"1",role:"user"}),e=>e.status===409);
  await f.members.changeRole(f.actor,{githubUserId:"2",role:"admin"});
  await f.members.changeRole(f.actor,{githubUserId:"1",role:"user"});
  assert.equal(await f.roles.currentRole("1"),"user");
  assert.equal(await f.roles.currentRole("2"),"admin");
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
