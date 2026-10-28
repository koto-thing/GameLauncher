import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { fixture } from './helpers/role-fixture.mjs';
import { createLtBindingFixture } from './helpers/lt-binding-fixture.mjs';
import { proxyLtCore } from '../lib/lt/proxy-core.ts';

// 実routeを依存注入してロードし、署名Cookieから内部RPC境界まで確認する
function load(path, dependencies) {
 const exports = {};
 const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 new Function('require','exports',source)(name => { assert.ok(name in dependencies,name); return dependencies[name]; },exports);
 return exports;
}
test('actual UI route uses internal binding after signed session validation', async t => {
 const f = await fixture(t);
 const {ltInternalAdapter} = load('../lib/lt/internal-adapter.ts',{});
 let calls = 0;
 const internal=createLtBindingFixture();
 const binding = {async operate(context,request) {
   calls++; assert.equal(context.actorId,f.actor.githubUserId); assert.equal(context.role,'assistant');
   assert.equal(request.headers.get('cookie'),null); assert.equal(request.headers.get('x-role'),null);
   return internal.operate(context,request);
 }};
 const env = {LT_INTERNAL:binding};
 const route = load('../app/api/lt/v1/operator/[...path]/route.ts',{'cloudflare:workers':{env},'@/lib/lt/proxy':{proxyLt:(request,adapter)=>proxyLtCore(request,r=>f.auth.requireRecentIdentity(r),adapter)},'@/lib/lt/internal-adapter':{ltInternalAdapter}});
 const url = 'http://127.0.0.1:18920/api/lt/v1/operator/events';
 const cookie = (await f.auth.createSessionCookie(f.actor,new Request(url))).split(';')[0];
 const request = (options={}) => new Request(url,{...options,headers:{cookie,...options.headers}});
 assert.equal((await route.GET(new Request(url,{headers:{'x-role':'admin'}}))).status,401);
 assert.equal((await route.POST(request({method:'POST',headers:{Origin:'https://evil.invalid','Content-Type':'application/json'},body:'{}'}))).status,403);
 assert.equal(calls,0);
 const response = await route.GET(request({headers:{'x-role':'admin','x-actor-id':'forged'}}));
 assert.equal(response.status,200); assert.ok(Array.isArray((await response.json()).items));
 const start=Date.UTC(2200,0,1)+Math.floor(Math.random()*1000000000)*60000;
 const created=await route.POST(request({method:"POST",headers:{Origin:"http://127.0.0.1:18920","Content-Type":"application/json","x-role":"admin"},body:JSON.stringify({title:"Local route Rust event",venue:"Example",guidance:"",startsAt:new Date(start).toISOString(),timeZone:"UTC",opensAt:new Date(start-120000).toISOString(),closesAt:new Date(start-60000).toISOString(),capacity:1,talkMinutes:5,transitionMinutes:1, approvalMode: "manual", scheduleMode: "manual", openingMinutes: 0, breakEvery: 4, breakMinutes: 0, closingMinutes: 0, endsBy: null,operationId:crypto.randomUUID()})})); assert.equal(created.status,200);
 delete env.LT_INTERNAL; assert.equal((await route.GET(request())).status,503); env.LT_INTERNAL=binding;
 f.sql.prepare("DELETE FROM platform_roles WHERE github_user_id='1'").run();
 assert.equal((await route.GET(request())).status,401);
 assert.equal(calls,2);
});

