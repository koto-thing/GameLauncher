import test from "node:test";
import assert from "node:assert/strict";
import { createRuntime, fixtureClient } from "../support/rental-runtime.mjs";

/** @brief 旧利用申請は自動昇格を許さず、共通の本人受諾招待だけがロールを変更する */
test("access requests preserve private identity and invite acceptance grants explicit platform roles", async (t) => {
  const runtime = await createRuntime({ php: { origin: "http://127.0.0.1:1", secret: "a".repeat(64) } });
  t.after(() => runtime.dispose());
  const admin = await fixtureClient(runtime,"admin");
  const executive = await fixtureClient(runtime,"maintainer");
  const assistant = await fixtureClient(runtime,"reviewer");
  const applicant = await fixtureClient(runtime,"outsider");
  const anonymous = await fixtureClient(runtime,"");
  const body = { action:"submit",service:"game",displayName:"Applicant",purpose:"Help publish games" };
  const write = /** @brief JSON書き込みを構成する */ (body: Record<string,unknown>) => ({ method:"POST",body });
  assert.equal((await anonymous.request("/api/access-requests",write(body))).status,401);
  assert.equal((await applicant.request("/api/access-requests",{...write(body),headers:{Origin:"https://evil.invalid"}})).status,403);
  const competing = await Promise.all([applicant.request("/api/access-requests",write({...body,applicantId:"1001"})),applicant.request("/api/access-requests",write(body))]);
  assert.deepEqual(competing.map(/** @brief 状態だけ比較する */ (r: Response)=>r.status).sort(),[201,409]);
  const mine = await applicant.json("/api/access-requests");
  assert.equal(mine.requests[0].applicant_id,"900004");
  assert.equal((await assistant.request("/api/access-requests?review=true")).status,403);
  assert.equal((await admin.request("/api/access-requests",write({action:"decide",service:"game",id:mine.requests[0].id,decision:"approved",grantType:"production_requester"}))).status,410);
  assert.equal((await applicant.request("/api/dashboard")).status,403);
  assert.equal((await assistant.request("/api/members",write({action:"invite",githubUserId:"900004",role:"assistant"}))).status,403);
  assert.equal((await executive.request("/api/members",write({action:"invite",githubUserId:"900004",role:"executive"}))).status,403);
  const invite = await executive.json("/api/members",write({action:"invite",githubUserId:"900004",role:"assistant"}));
  assert.equal((await applicant.request("/api/members",write({action:"accept",id:invite.id,role:"admin"}))).status,400);
  await applicant.json("/api/members",write({action:"accept",id:invite.id}));
  assert.equal((await applicant.request("/api/dashboard")).status,200);
  assert.deepEqual(await applicant.json("/api/auth/services"),{game:true,music:true});
  assert.equal((await applicant.request("/api/members",write({action:"set_role",githubUserId:"900004",role:"admin"}))).status,403);
  await admin.json("/api/members",write({action:"set_role",githubUserId:"900004",role:"user"}));
  assert.equal((await applicant.request("/api/dashboard")).status,403);
  assert.equal((await applicant.request("/manage/games")).status,403);
  assert.equal((await applicant.request("/api/members",write({action:"accept",id:invite.id}))).status,409);
});
