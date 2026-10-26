import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createTestHarness } from 'wrangler';

// NodeのRequest実装では再現しないWorkers固有の構築制約を実runtimeで検査する
test('native Workers proxy constructs manual requests and strips browser credentials', async () => {
  const server = createTestHarness({workers:[{config:{name:'lt-native-request-test',
    main:fileURLToPath(new URL('./fixtures/lt-proxy-native-worker.ts',import.meta.url)),compatibility_date:'2026-05-22'}}]});
  try {
    await server.listen();
    const control = await server.fetch('http://localhost/unsupported');
    assert.deepEqual(await control.json(), {rejected:true});
    const url = 'http://localhost/api/lt/v1/operator/events';
    const headers = {'x-local-fixture':'allowed',cookie:'synthetic-only',authorization:'synthetic-only','x-role':'admin'};
    const get = await server.fetch(url,{headers});
    assert.equal(get.status,200);
    assert.deepEqual(await get.json(),{redirect:'manual',cookie:false,authorization:false,role:false,method:'GET',body:null});
    const post = await server.fetch(url,{method:'POST',headers:{...headers,origin:'http://localhost','content-type':'application/json'},body:'{"fixture":true}'});
    assert.equal(post.status,200);
    assert.deepEqual(await post.json(),{redirect:'manual',cookie:false,authorization:false,role:false,method:'POST',body:{fixture:true}});
    const redirect = await server.fetch(url+'?redirect=1',{headers});
    assert.equal(redirect.status,302);
    assert.equal(redirect.headers.get('location'),null);
    assert.equal((await redirect.json()).error.code,'VALIDATION');
    const anonymous = await server.fetch(url);
    assert.equal(anonymous.status,401);
    assert.equal((await anonymous.json()).error.code,'UNAUTHENTICATED');
  } finally { await server.close(); }
});
