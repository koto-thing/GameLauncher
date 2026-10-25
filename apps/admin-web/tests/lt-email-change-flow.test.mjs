import test from 'node:test';
import assert from 'node:assert/strict';
import { EmailChangeFlow } from '../lib/lt/email-change-flow.ts';
const status=(state='investigating',version=1,id='request')=>({id,applicationId:'application',version,applicationVersion:1,state,newEmail:'new@example.invalid',verificationExpiresAt:null,verifiedAt:null});
test('unknown outcome reuses identical body and operationId; double click sends once',async()=>{
 let release; const calls=[]; let fail=true;
 const flow=new EmailChangeFlow(1,async(action,body)=>{calls.push(structuredClone(body));await new Promise(resolve=>{release=resolve});if(fail)throw Error('network');return status();});
 const first=flow.act('investigate',{newEmail:'new@example.invalid'});await flow.act('investigate',{newEmail:'different@example.invalid'});assert.equal(calls.length,1);release();await assert.rejects(first);
 const second=flow.act('investigate',{newEmail:'different@example.invalid'});fail=false;release();await second;assert.deepEqual(calls[0],calls[1]);
});
test('cannot confirm before verification or after request replacement refresh',async()=>{
 let current=status('verificationPending');const calls=[];const flow=new EmailChangeFlow(1,async(action,body)=>{calls.push(action);if(!action)return current;throw Error('network');});await flow.refresh();await assert.rejects(flow.act('confirm'));assert.deepEqual(calls,['']);
 current=status('verified',2);await flow.refresh();await assert.rejects(flow.act('confirm'));const old=flow.pending.body.operationId;
 current=status('verificationPending',1,'replacement');await flow.refresh();assert.equal(flow.pending,null);await assert.rejects(flow.act('confirm'));assert.notEqual(flow.current.id,'request');assert.ok(old);
});
test('409 blocks until refresh; assistant 403 never progresses',async()=>{
 const flow=new EmailChangeFlow(1,async()=>{throw Object.assign(Error('denied'),{status:403})});await assert.rejects(flow.act('investigate',{}));assert.equal(flow.blocked,true);assert.equal(flow.pending,null);
 const conflict=new EmailChangeFlow(1,async()=>{throw Object.assign(Error('stale'),{status:409})});await assert.rejects(conflict.act('investigate',{}));await assert.rejects(conflict.act('investigate',{}),/再読込/);
});
test('resend uses fresh operation and adopts current token state',async()=>{
 let version=1;let token='old';const flow=new EmailChangeFlow(1,async(action)=>{if(action==='send-verification'){version++;token='new';}return status('verificationPending',version)});await flow.refresh();await flow.act('send-verification');assert.equal(flow.current.version,2);assert.equal(token,'new');assert.equal(flow.pending,null);
});

test('fixture resend revokes old token and stale request confirmation returns409',async()=>{
 let request=status(); let sequence=0; const validTokens=new Set(); const receipts=new Map();
 const flow=new EmailChangeFlow(1,async(action,body)=>{
   if(!action)return structuredClone(request);
   if(body.data.requestId && (body.data.requestId!==request.id || body.data.expectedRequestVersion!==request.version))throw Object.assign(Error('stale request'),{status:409});
   if(receipts.has(body.operationId))return receipts.get(body.operationId);
   if(action==='send-verification'){validTokens.clear();validTokens.add('token-'+(++sequence));request={...request,version:request.version+1,state:'verificationPending'};}
   if(action==='confirm'){if(request.state!=='verified')throw Object.assign(Error('unverified'),{status:409});request={...request,version:request.version+1,state:'confirmed',applicationVersion:2};}
   receipts.set(body.operationId,structuredClone(request));return structuredClone(request);
 });
 await flow.refresh();await flow.act('send-verification');const first='token-1';await flow.act('send-verification');assert.equal(validTokens.has(first),false);assert.equal(validTokens.has('token-2'),true);
 request={...request,version:request.version+1,state:'verified'};await flow.refresh();request={...request,id:'replacement',version:1,state:'verificationPending'};
 await assert.rejects(flow.act('confirm'));assert.equal(flow.blocked,true);assert.equal(request.state,'verificationPending');
});
