import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/role-fixture.mjs';
import { createLtBindingFixture } from './helpers/lt-binding-fixture.mjs';
import { proxyLtCore } from '../lib/lt/proxy-core.ts';

// 既存authの署名Cookie・在籍・role検証を実proxyとRust RPCへ接続する
const base='http://127.0.0.1:8792/api/lt/v1/operator';

test('signed GitHub fixture through real proxy to explicit internal RPC fixture',async t=>{
 const f=await fixture(t);
 const binding=createLtBindingFixture();
 const adapter={fetch:(request,context)=>binding.operate(context,request)};
 const auth=request=>f.auth.requireRecentIdentity(request);
 const cookie=(await f.auth.createSessionCookie(f.actor,new Request(base))).split(';')[0];
 const request=(path,options={})=>new Request(base+path,{...options,headers:{cookie,...options.headers}});
 assert.equal((await proxyLtCore(new Request(base+'/events'),auth,adapter)).status,401);
 assert.equal((await proxyLtCore(request('/events',{method:'POST',headers:{Origin:'https://evil.invalid','Content-Type':'application/json'},body:'{}'}),auth,adapter)).status,403);
 assert.equal((await proxyLtCore(request('/events'),auth)).status,503);
 assert.equal((await proxyLtCore(request('/applications/x/email-change/confirm',{method:'POST',headers:{Origin:'http://127.0.0.1:8792','Content-Type':'application/json'},body:'{}'}),auth,adapter)).status,403);
 const result=await proxyLtCore(request('/events',{headers:{'x-role':'admin','x-actor-id':'forged'}}),auth,adapter);
 assert.equal(binding.calls.length,1); assert.equal(binding.calls[0].context.actorId,f.actor.githubUserId); assert.equal(binding.calls[0].context.role,'assistant');
 assert.equal(result.status,200); assert.ok(Array.isArray((await result.json()).items));
 // 通常操作成功でも主体は署名Cookieからのみ取得する
 const year=4000+Math.floor(Math.random()*2000);
 const mutation={title:'Fixture integration',venue:'Example',guidance:'',startsAt:`${year}-03-01T04:00:00.000Z`,timeZone:'UTC',opensAt:`${year}-01-01T00:00:00.000Z`,closesAt:`${year}-02-01T00:00:00.000Z`,capacity:1,talkMinutes:5,transitionMinutes:1,operationId:crypto.randomUUID()};
 const created=await proxyLtCore(request('/events',{method:'POST',headers:{Origin:'http://127.0.0.1:8792','Content-Type':'application/json','x-role':'admin'},body:JSON.stringify(mutation)}),auth,adapter);
 assert.equal(created.status,200); const value=await created.json(); assert.equal(value.title,mutation.title);
 f.sql.prepare("DELETE FROM platform_roles WHERE github_user_id='1'").run();
 assert.equal((await proxyLtCore(request('/events'),auth,adapter)).status,401);
 f.sql.prepare("INSERT INTO platform_roles VALUES('1','assistant','1','now')").run();
 f.sql.prepare("UPDATE operator_admissions SET revoked_at='now' WHERE github_user_id='1'").run();
 assert.equal((await proxyLtCore(request('/events'),auth,adapter)).status,401);
});
