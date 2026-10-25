import assert from 'node:assert/strict';
import test from 'node:test';
import { expectStatus } from './helpers/safe-response-status.mjs';
import { randomUUID } from 'node:crypto';
import { createAdminTestHarness } from './helpers/admin-worker-harness.mjs';
// 実際の Worker に合成データを渡し、型変換拒否と永続化の境界を確認する
 test('authenticated multipart preserves strict number validation and seal transitions', async () => {
 const server=createAdminTestHarness({vars:{LOCAL_DEV_AUTH:"true",MUSIC_ENABLED:"false",STAGING_DISPATCH_ENABLED:"false",PRODUCTION_DISPATCH_ENABLED:"false"},secrets:{SESSION_SECRET:"synthetic-local-session-secret-only"}});await server.listen();
 try {
 const origin='http://localhost';
 let completedRequests=0;
 /** 各要求の本文を読み終え、実Workerのストリームを次の要求へ持ち越さない */
 const fetchComplete=async (...args)=>{
   const response=await server.fetch(...args);
   const body=await response.arrayBuffer();
   if(response.status===500) {
 const logs=server.getLogs();
 const categories=logs.map(log=>{const text=String(log.message);return /Network connection lost|disconnected|connection reset/i.test(text)?'network':/exit|terminated|crash/i.test(text)?'runtime_exit':/reload|restart/i.test(text)?'reload':/D1_ERROR|SQLITE_/i.test(text)?'database':/TypeError/i.test(text)?'type_error':/ReferenceError/i.test(text)?'reference_error':/exception/i.test(text)?'exception':'other';});
 console.info(JSON.stringify({stage:'multipart-response',request:completedRequests+1,previousResponsesConsumed:completedRequests,status:500,runtimeLogCount:logs.length,categories}));
 }
   completedRequests++;
   return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
 };
 const login=await fetchComplete(origin+'/api/auth/dev?as=admin',{redirect:'manual'});
 await expectStatus(login,302);
 const cookie=login.headers.get('set-cookie').split(';')[0];
 /** 認証済みの同一オリジン要求を送る */
 const send=(path,body,method='POST',extra={})=>fetchComplete(origin+path,{method,headers:{cookie,origin,'content-type':'application/json',...extra},body:typeof body==='string'?body:JSON.stringify(body)});
 const artifactId=randomUUID(), root='/api/intake/uploads', path=root+'/'+artifactId;
 const descriptor={schemaVersion:1,artifactId,artifactFile:'test-game-1.0.0.zip',gameId:'test-game',version:'1.0.0',platform:'windows',arch:'x86_64',sizeBytes:3,fileCount:1,sha256:'a'.repeat(64),createdAt:new Date().toISOString()};
 assert.equal((await fetchComplete(origin+root,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(descriptor)})).status,401);
 let response=await send(root,descriptor);await expectStatus(response,201);
 for(const partNumber of ['1',true,false,null,[],[1],{},0,1.5,2]) {
 response=await send(path+'/parts',{completed:{partNumber,etag:'synthetic',sizeBytes:3}});
 await expectStatus(response,400);assert.equal((await response.json()).error,'part番号が不正です');
 }
 response=await send(root,descriptor);assert.deepEqual((await response.json()).uploadedParts,[]);
 response=await send(path+'/seal',{});await expectStatus(response,400);
 response=await send(path+'/parts',{completed:{partNumber:1,etag:'synthetic',sizeBytes:2}});await expectStatus(response,400);assert.equal((await response.json()).error,'part容量が期待値と一致しません');
 response=await send(root,descriptor);assert.deepEqual((await response.json()).uploadedParts,[]);
 response=await send(path+'/parts/1','abc','PUT',{'content-length':'3'});await expectStatus(response,200);
 const uploaded=await response.json();
 response=await send(path+'/parts',{completed:{partNumber:1,etag:uploaded.etag,sizeBytes:3}});await expectStatus(response,200);
 response=await send(path+'/seal',{});await expectStatus(response,200);
 response=await send(path+'/parts',{completed:{partNumber:1,etag:uploaded.etag,sizeBytes:3}});await expectStatus(response,400);
 } finally {await server.close();}
 });
