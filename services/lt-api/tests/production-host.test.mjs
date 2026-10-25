import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('production host defers Wasm until permitted processing and preserves context', async()=>{
  let loads=0;
  const ctx={fixture:true};
  const env={LT_PRIVATE_API_ENABLED:'false'};
  globalThis.ltCpuFixtureModule=async()=>{
    loads++;
    return {default:class {
      constructor(actualCtx,actualEnv){assert.equal(actualCtx,ctx);assert.equal(actualEnv,env);}
      fetch(request){return Response.json({path:new URL(request.url).pathname});}
      operator_request(context,request,actualEnv){assert.equal(actualEnv,env);return Response.json({context,path:new URL(request.url).pathname});}
      scheduled(){return 'scheduled';}
    }};
  };
  let source=await readFile(new URL('../production-entry.mjs',import.meta.url),'utf8');
  source=source.replace("import { WorkerEntrypoint } from 'cloudflare:workers';",'class WorkerEntrypoint {constructor(ctx,env){this.ctx=ctx;this.env=env;}}');
  for(const name of ['host-gate','host-metrics']) source=source.replace(`'./${name}.mjs'`,JSON.stringify(new URL(`../${name}.mjs`,import.meta.url).href));
  source=source.replace("import('./build/index.js')",'globalThis.ltCpuFixtureModule()');
  try {
    const module=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
    const http=new module.default(ctx,env);const operator=new module.LtOperator(ctx,env);
    const request=new Request('https://example.invalid/api/lt/v1/auth/session');
    assert.equal((await http.fetch(request)).status,501);
    assert.equal((await operator.operate({role:'admin'},request)).status,501);
    await http.scheduled({});assert.equal(loads,0);
    assert.equal((await http.fetch(new Request('https://example.invalid/api/lt/v1/operator/events'))).status,404);
    assert.equal(loads,0);
    assert.equal((await http.fetch(new Request('https://example.invalid/api/lt/v1/events'))).status,200);
    assert.equal(loads,1);
    env.LT_OPERATOR_API_ENABLED='true';
    const context={actorId:'fixture',role:'assistant',requestId:'fixture'};
    assert.deepEqual((await (await operator.operate(context,request)).json()).context,context);
    assert.equal(loads,1);
    env.LT_PRIVATE_API_ENABLED='true';env.LT_MAINTENANCE_ENABLED='true';assert.equal(await http.scheduled({}),'scheduled');
    assert.equal('testMail' in operator,false);assert.equal('testClock' in operator,false);
  } finally {delete globalThis.ltCpuFixtureModule;}
});
