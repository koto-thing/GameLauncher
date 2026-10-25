import {test} from 'node:test';
import assert from 'node:assert/strict';

test('module counter and marker persist across requests without logging query or cookie',async()=>{
  const {traceSynthetic}=await import('../host-metrics.mjs?fixture=counter');
  const logs=[];const original=console.log;
  console.log=value=>logs.push(JSON.parse(value));
  const request=new Request('https://example.invalid/api/lt/v1/events?token=PRIVATE_CANARY',{headers:{cookie:'PRIVATE_COOKIE'}});
  try {
    traceSynthetic(request,{LT_SYNTHETIC_METRICS:'true'},true,'http',0);
    traceSynthetic(request,{LT_SYNTHETIC_METRICS:'true'},true,'http',1);
  } finally {console.log=original;}
  assert.deepEqual(logs.map(log=>log.requestInModule),[1,2]);
  assert.deepEqual(logs.map(log=>log.firstInIsolate),[true,false]);
  assert.deepEqual(logs.map(log=>log.rustFirstInIsolate),[true,false]);
  assert.deepEqual(logs.map(log=>log.wasmModuleLoads),[0,1]);
  assert.equal(logs[0].moduleMarker,logs[1].moduleMarker);
  assert.doesNotMatch(JSON.stringify(logs),/PRIVATE_CANARY|PRIVATE_COOKIE/);
});


test('RPC logs correlate only a valid server UUID and never include context or body',async()=>{
  const {traceSynthetic,traceOperatorResult}=await import('../host-metrics.mjs?fixture=rpc');
  const id='00000000-0000-4000-8000-000000000001';
  const logs=[];const original=console.log;console.log=value=>logs.push(JSON.parse(value));
  try {
    const request=new Request('https://lt.internal/api/lt/v1/operator/events',{method:'POST',body:'PRIVATE_BODY',headers:{cookie:'PRIVATE_COOKIE'}});
    traceSynthetic(request,{LT_SYNTHETIC_METRICS:'true'},true,'operator',0,id);
    traceOperatorResult({LT_SYNTHETIC_METRICS:'true'},id,200);
    traceOperatorResult({LT_SYNTHETIC_METRICS:'true'},'PRIVATE_TOKEN',503);
  } finally {console.log=original;}
  assert.equal(logs.length,2);assert.equal(logs[0].requestId,id);
  assert.deepEqual(logs[1],{ltOperatorRpc:true,requestId:id,status:200});
  assert.doesNotMatch(JSON.stringify(logs),/PRIVATE|cookie|actor|body/i);
});
