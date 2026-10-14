import test from "node:test";
import assert from "node:assert/strict";
import { createRuntime, fixtureClient } from "../support/rental-runtime.mjs";

// 実OAuth callback・D1トランザクション・Music本人参照・公開PHPを通す
test("operator pre-invitation, bounded OAuth acceptance, concurrency, revocation and public independence", /** @brief 本物のOAuthとD1で運営専用境界を確認する */ async t => {
  let identity = {id:900004,login:"new-operator",avatar_url:""};
  const runtime = await createRuntime({
    github: /** @brief GitHubだけを偽装し、PHP bridgeはローカル実サーバーへ送る */ async (request:Request) => {
      const url=new URL(request.url);
      if(url.hostname==="github.com") return Response.json({access_token:"test-token"});
      if(url.hostname==="api.github.com") return Response.json(identity);
      return fetch(request);
    },
  });
  t.after(/** @brief テストが所有するWorkerとPHPだけを停止する */ () => runtime.dispose());
  const admin=await fixtureClient(runtime,"admin");
  const executive=await fixtureClient(runtime,"maintainer");
  const assistant=await fixtureClient(runtime,"reviewer");
  const anonymous=await fixtureClient(runtime,"");
  const write=/** @brief 同一Originの管理書き込みを作る */ (body:Record<string,unknown>)=>({method:"POST",body});
  const invite={action:"invite",login:"new-operator",confirmedId:"900004",role:"assistant"};
  /** @brief GitHubのstateとPKCEを本番ハンドラーで検証する */
  async function oauth() {
    const start=await runtime.dispatchFetch(runtime.origin+"/api/auth/github/start",{redirect:"manual"});
    const state=new URL(start.headers.get("location")!).searchParams.get("state");
    return runtime.dispatchFetch(runtime.origin+`/api/auth/github/callback?code=test&state=${state}`,{redirect:"manual",headers:{cookie:start.headers.get("set-cookie")!.split(";")[0]}});
  }
  /** @brief 複数Set-Cookieから運営または受諾Cookieを抽出する */
  function cookie(response:{headers:{getSetCookie():string[]}}) {
    return response.headers.getSetCookie().find(value=>value.startsWith("pandd_deploy_session="))?.split(";")[0] ?? "";
  }
  /** @brief 同じCookieで各サービスの本物の入口を叩く */
  function request(path:string,proof:string,body?:Record<string,unknown>) {
    return runtime.dispatchFetch(runtime.origin+path,{method:body?"POST":"GET",headers:{cookie:proof,origin:runtime.origin,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
  }
  assert.equal((await oauth()).status,403);
  assert.equal(await runtime.db.prepare("SELECT 1 FROM users WHERE github_user_id='900004'").first(),null);
  assert.equal((await anonymous.request("/api/members")).status,401);
  assert.equal((await anonymous.request("/api/access-requests",write({action:"submit",service:"game"}))).status,404);
  assert.equal((await assistant.request("/api/members",write(invite))).status,403);
  assert.equal((await executive.request("/api/members",write({...invite,role:"executive"}))).status,403);
  const competing=await Promise.all([executive.request("/api/members",write(invite)),executive.request("/api/members",write(invite))]);
  assert.deepEqual(competing.map(/** @brief 並行招待は一つだけ成功する */ (r:{status:number})=>r.status).sort(),[201,409]);
  const invitation=await competing.find(/** @brief 成功した招待を選ぶ */ (r:{status:number})=>r.status===201)!.json() as {id:string};
  const callback=await oauth();
  assert.equal(callback.status,302);
  assert.equal(callback.headers.get("location"),"/invitations");
  const proof=cookie(callback);
  assert.match(proof,/pandd_deploy_session=/);
  assert.equal((await request("/api/invitations",proof)).status,200);
  for(const path of ["/api/members","/api/music/manage/games"]) assert.equal((await request(path,proof)).status,401);
  assert.deepEqual(await (await request("/api/auth/services",proof)).json(),{game:false,music:false});
  assert.equal((await request("/api/intake/uploads",proof,{})).status,401);
  assert.equal((await request("/api/invitations",proof,{id:invitation.id,role:"admin"})).status,400);
  identity={id:900005,login:"new-operator",avatar_url:""};
  assert.equal((await oauth()).status,403);
  const accepts=await Promise.all([request("/api/invitations",proof,{id:invitation.id}),request("/api/invitations",proof,{id:invitation.id})]);
  assert.equal(accepts.filter(/** @brief D1の原子的な受諾は一度だけ成功する */ (r:{status:number})=>r.status===200).length,1);
  assert.ok(accepts.some(/** @brief もう片方は失効または使用済みとして拒否する */ (r:{status:number})=>[403,409].includes(r.status)));
  const session=cookie(accepts.find(/** @brief 通常セッションは成功した受諾だけに付く */ (r:{status:number})=>r.status===200)!);
  assert.deepEqual(await (await request("/api/auth/services",session)).json(),{game:true,music:true});
  assert.equal((await runtime.db.prepare("SELECT login FROM music_accounts WHERE id='900004'").first()).login,"new-operator");
  const draft=await request("/api/music/manage/games",session,{title:"New operator FK check",description:"",imageAssetId:null,imageAlt:"",externalUrl:"",rightsConfirmed:true});
  assert.equal(draft.status,201,await draft.clone().text());
  await admin.json("/api/members",write({action:"set_role",githubUserId:"900004",role:null}));
  assert.equal((await request("/api/music/manage/games",session)).status,401);
  assert.equal((await request("/api/members",session)).status,401);
  assert.equal((await request("/api/invitations",proof,{id:invitation.id})).status,403);
  // 別々のAdminが同時に相手を降格させても最後の有効Adminは残る
  const secondAdmin=await fixtureClient(runtime,"music-admin");
  const demotions=await Promise.all([
    admin.request("/api/members",write({action:"set_role",githubUserId:"900001",role:"assistant"})),
    secondAdmin.request("/api/members",write({action:"set_role",githubUserId:"1001",role:"assistant"})),
  ]);
  assert.equal(demotions.filter(/** @brief 一方だけが権限を変更できる */ (r:{status:number})=>r.status===200).length,1);
  assert.equal((await runtime.db.prepare("SELECT COUNT(*) n FROM active_platform_roles WHERE role='admin'").first()).n,1);
  assert.equal((await fetch(runtime.php.origin+"/api/public/catalogue")).status,200);
  assert.equal(await runtime.db.prepare("SELECT 1 FROM users WHERE github_user_id='900004'").first() !== null,true);
});
