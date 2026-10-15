import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./helpers/role-fixture.mjs";

// GitHub外部通信だけを置き換え、本物の認証・SQL・Cookie・HTTPハンドラーを実行する
function github(t, initial = {id:2,login:"new-member",avatar_url:""}) {
  const state = {user:initial,lookup:initial};
  t.mock.method(globalThis,"fetch",async (url) => {
    if (String(url) === "https://api.github.com/user") return Response.json(state.user);
    if (String(url).startsWith("https://api.github.com/users/")) return Response.json(state.lookup);
    throw new Error("Unexpected network request");
  });
  return state;
}

// 招待対象本人の確認済みIDはUIプレビュー由来で、サーバーがGitHub情報を再取得する
async function invite(f, input = {}) {
  return f.members.inviteMember(f.actor,{login:"new-member",confirmedId:"2",role:"assistant",...input});
}

// Cookieの署名からDB許可の再確認まで検証する
async function requestFor(f, actor) {
  return new Request("https://admin.test",{headers:{cookie:(await f.auth.createSessionCookie(actor,new Request("https://admin.test"))).split(";")[0]}});
}

for (const role of ["assistant","executive","admin"]) {
  test(`existing ${role} can authenticate by ID and case-insensitive approved name`,async t => {
    const f = await fixture(t,{role});
    github(t,{id:1,login:"OPERATOR",avatar_url:""});
    const user = await f.auth.verifyGithubIdentity("token");
    assert.equal(user.role,role);
    assert.equal((await f.auth.readSession(await requestFor(f,user))).role,role);
    assert.equal(f.sql.prepare("SELECT approved_login FROM operator_admissions").get().approved_login,"operator");
  });
}

test("unlisted and legacy general identities get 403 without users or normal sessions, including uploader",async t => {
  const f = await fixture(t);
  const state = github(t);
  await assert.rejects(f.auth.verifyGithubIdentity("token",true),e=>e.status===403);
  await assert.rejects(f.auth.requireUploaderActor(new Request("https://admin.test",{headers:{authorization:"Bearer token"}})),e=>e.status===403);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM users").get().n,1);
  f.sql.prepare("INSERT INTO users VALUES ('2','new-member','',1,'now')").run();
  f.sql.prepare("INSERT INTO platform_roles VALUES ('2','user','1','now')").run();
  await assert.rejects(f.auth.verifyGithubIdentity("token",true),e=>e.status===403);
  state.user={id:1,login:"operator",avatar_url:""};
  f.sql.exec("DELETE FROM operator_admissions");
  await assert.rejects(f.auth.verifyGithubIdentity("token"),e=>e.status===403);
});

test("pre-invitation verifies username, refuses ID substitution, duplicate and executive escalation",async t => {
  const f = await fixture(t,{role:"executive"});
  github(t);
  for (const role of ["admin","executive"]) await assert.rejects(invite(f,{role}),e=>e.status>=400);
  await assert.rejects(invite(f,{githubUserId:"2"}),e=>e.status===400);
  await assert.rejects(invite(f,{confirmedId:"3"}),e=>e.status===409);
  await assert.rejects(invite(f,{action:"reapprove"}),e=>e.status===403);
  await invite(f);
  await assert.rejects(invite(f),e=>e.status===409);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM users").get().n,1);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM music_accounts").get().n,0);
});

test("only invited OAuth identity accepts; limited cookie cannot enter operations; Music identity is atomic",async t => {
  const f = await fixture(t,{role:"admin"});
  const state=github(t);
  const {id}=await invite(f,{role:"executive"});
  const pending=await f.auth.verifyGithubIdentity("token",true);
  assert.equal(pending.invitationId,id);
  assert.equal(await f.auth.readSession(await requestFor(f,pending)),null);
  for (const api of [f.memberApi,f.controlApi]) assert.equal((await f.call(api,{action:"set_role",githubUserId:"1",role:"admin"},pending)).status,401);
  await assert.rejects(f.auth.verifyGithubToken("token"),e=>e.status===403);
  await assert.rejects(f.members.acceptInvitation({...pending,githubUserId:"3"},{id}),e=>e.status===409);
  assert.equal((await f.call(f.invitationApi,{id,role:"admin"},pending)).status,400);
  assert.equal((await f.call(f.invitationApi,{id,githubUserId:"1"},pending)).status,400);
  state.user={id:3,login:"new-member",avatar_url:""};
  await assert.rejects(f.auth.verifyGithubIdentity("token",true),e=>e.status===403);
  const accepted=await f.call(f.invitationApi,{id},pending);
  assert.equal(accepted.status,200,await accepted.clone().text());
  const session=await f.auth.readSession(new Request("https://admin.test",{headers:{cookie:accepted.headers.get("set-cookie")}}));
  assert.equal(session.role,"executive");
  assert.equal(f.sql.prepare("SELECT login FROM music_accounts WHERE id='2'").get().login,"new-member");
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM operation_events WHERE action='invitation.accepted'").get().n,1);
  assert.equal((await f.call(f.invitationApi,{id},pending)).status,403);
});

for (const invalidation of ["expiry","cancel","issuer-demotion","issuer-revocation","issuer-deletion","tamper-role"]) {
  test(`pending invitation rejects ${invalidation} both at OAuth and acceptance`,async t => {
    const f=await fixture(t,{role:"executive"});
    github(t);
    const {id}=await invite(f);
    const pending=await f.auth.verifyGithubIdentity("token",true);
    if(invalidation==="expiry")f.sql.exec("UPDATE operator_invitations SET expires_at='2000-01-01'");
    if(invalidation==="cancel")await f.members.revokeInvitation(f.actor,{id});
    if(invalidation==="issuer-demotion")f.sql.exec("UPDATE platform_roles SET role='assistant' WHERE github_user_id='1'");
    if(invalidation==="issuer-revocation")f.sql.exec("UPDATE operator_admissions SET revoked_at='now'");
    if(invalidation==="issuer-deletion")f.sql.exec("DELETE FROM platform_roles");
    if(invalidation==="tamper-role")f.sql.exec("UPDATE operator_invitations SET role='executive'");
    await assert.rejects(f.auth.verifyGithubIdentity("token",true),e=>e.status===403);
    assert.equal((await f.call(f.invitationApi,{id},pending)).status,403);
    await assert.rejects(f.members.acceptInvitation(pending,{id}),e=>e.status===409);
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM users").get().n,1);
  });
}

test("cancellation remains effective after reinvite, expired invite can be replaced, and pending proof expires after ten minutes",async t => {
  const f=await fixture(t,{role:"admin"});github(t);
  const first=await invite(f);
  const old=await f.auth.verifyGithubIdentity("token",true);
  await f.members.revokeInvitation(f.actor,{id:first.id});
  const second=await invite(f);
  assert.notEqual(first.id,second.id);
  assert.equal((await f.call(f.invitationApi,{id:first.id},old)).status,403);
  f.sql.exec("UPDATE operator_invitations SET expires_at='2000-01-01'");
  const third=await invite(f);
  const pending=await f.auth.verifyGithubIdentity("token",true);
  pending.authenticatedAt=new Date(Date.now()-600001).toISOString();
  assert.equal((await f.call(f.invitationApi,{id:third.id},pending)).status,403);
});

test("Music identity failure rolls back invitation, users and role; retry then succeeds",async t => {
  const f=await fixture(t,{role:"admin"});github(t);
  const {id}=await invite(f);
  const pending=await f.auth.verifyGithubIdentity("token",true);
  f.sql.exec("CREATE TRIGGER fail_music BEFORE INSERT ON music_accounts BEGIN SELECT RAISE(ABORT,'music unavailable'); END");
  await assert.rejects(f.members.acceptInvitation(pending,{id}),/music unavailable/);
  assert.equal(f.sql.prepare("SELECT accepted_at FROM operator_invitations").get().accepted_at,null);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM users").get().n,1);
  assert.equal(await f.roles.currentRole("2"),null);
  f.sql.exec("DROP TRIGGER fail_music");
  await f.members.acceptInvitation(pending,{id});
  assert.equal(await f.roles.currentRole("2"),"assistant");
});

test("Admin promotion, final Admin protection, revocation and regrant never revive old sessions",async t => {
  const f=await fixture(t,{role:"admin"});github(t);
  const {id}=await invite(f,{role:"executive"});
  const member=await f.members.acceptInvitation(await f.auth.verifyGithubIdentity("token",true),{id});
  const old=await requestFor(f,member);
  await assert.rejects(f.members.changeRole(f.actor,{githubUserId:"1",role:null}),e=>e.status===409);
  await f.members.changeRole(f.actor,{githubUserId:"2",role:"admin"});
  assert.equal(await f.auth.readSession(old),null);
  await f.members.changeRole(f.actor,{githubUserId:"2",role:null});
  assert.equal(await f.roles.currentRole("2"),null);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM users WHERE github_user_id='2'").get().n,1);
  const next=await invite(f);
  await f.members.acceptInvitation(await f.auth.verifyGithubIdentity("token",true),{id:next.id});
  assert.equal(await f.auth.readSession(old),null);
});

test("rename refuses OAuth, invalidates observed sessions, requires Admin reapproval and blocks recycled old name",async t => {
  const f=await fixture(t,{role:"admin"});
  const state=github(t);
  const {id}=await invite(f);
  const member=await f.members.acceptInvitation(await f.auth.verifyGithubIdentity("token",true),{id});
  const old=await requestFor(f,member);
  state.user={id:2,login:"renamed",avatar_url:""};
  // GitHub is not queried per HTTP request: the original cookie remains valid until identity is observed or expires
  assert.ok(await f.auth.readSession(old));
  await assert.rejects(f.auth.verifyGithubIdentity("token",true),e=>e.status===403);
  assert.equal(await f.auth.readSession(old),null);
  assert.equal(f.sql.prepare("SELECT approved_login FROM operator_admissions WHERE github_user_id='2'").get().approved_login,"new-member");
  state.user={id:3,login:"new-member",avatar_url:""};
  await assert.rejects(f.auth.verifyGithubIdentity("token",true),e=>e.status===403);
  state.user=state.lookup={id:2,login:"renamed",avatar_url:""};
  const next=await invite(f,{action:"reapprove",login:"renamed",role:"admin"});
  const pending=await f.auth.verifyGithubIdentity("token",true);
  const accepted=await f.members.acceptInvitation(pending,{id:next.id});
  assert.equal(accepted.role,"assistant");
  assert.ok(await f.auth.readSession(await requestFor(f,accepted)));
  assert.equal(await f.auth.readSession(old),null);
});

test("removing admission or membership invalidates a signed session on the next request",async t => {
  const f=await fixture(t,{role:"admin"});
  const request=await requestFor(f,f.actor);
  f.sql.exec("DELETE FROM operator_admissions");
  assert.equal(await f.auth.readSession(request),null);
  f.sql.exec("INSERT INTO operator_admissions VALUES('1','operator','fixture-1',NULL); DELETE FROM platform_roles");
  assert.equal(await f.auth.readSession(request),null);
});
