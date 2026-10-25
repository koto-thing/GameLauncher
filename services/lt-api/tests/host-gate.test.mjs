import {test} from 'node:test';
import assert from 'node:assert/strict';
import {earlyResponse,privateResponse} from '../host-gate.mjs';

test('disabled private paths never read DB or accept forged role headers',async()=>{
  const env={get DB(){throw Error('DB must not be accessed');}};
  for(const path of ['/api/lt/v1/auth/session','/api/lt/v1/applications/a','/auth/verify','/auth/email-change']) {
    const response=earlyResponse(new Request('https://example.invalid'+path,{headers:{'x-role':'admin'}}),env);
    assert.equal(response.status,501);assert.equal((await response.json()).error.code,'NOT_IMPLEMENTED');
  }
});
test('HTTP operator routes never enter Rust RPC',()=>{
  for(const path of ['/api/lt/v1/operator','/api/lt/v1/operator/events']) {
    assert.equal(earlyResponse(new Request('https://example.invalid'+path),{LT_PRIVATE_API_ENABLED:'true'}).status,404);
  }
});
test('active private requests remain subject to Rust auth and lifecycle validation',()=>{
  for(const env of [{LT_PRIVATE_API_ENABLED:'true'},{LOCAL_AUTH:'true'}]) {
    assert.equal(privateResponse(env),undefined);
    assert.equal(earlyResponse(new Request('https://example.invalid/api/lt/v1/applications'),env),undefined);
  }
  assert.equal(privateResponse({LT_PRIVATE_API_ENABLED:true}).status,501);
});
test('normal public reads always reach the Rust lifecycle and allowlist',()=>{
  assert.equal(earlyResponse(new Request('https://example.invalid/api/lt/v1/events'),{}),undefined);
});
