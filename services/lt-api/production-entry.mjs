import { WorkerEntrypoint } from 'cloudflare:workers';
import { earlyResponse, operatorResponse } from './host-gate.mjs';
import { traceSynthetic, traceOperatorResult } from './host-metrics.mjs';

// 拒否する要求では Wasm を初期化しない。業務処理・認可は Rust に委ねる。
let apiModule;
let apiModuleLoads = 0;
async function instance(host) {
  const { default: Api } = await (apiModule ??= import('./build/index.js').then(module => {apiModuleLoads++; return module;}));
  return new Api(host.ctx, host.env);
}

export default class LtHttp extends WorkerEntrypoint {
  async fetch(request) {
    const denied = earlyResponse(request, this.env);
    traceSynthetic(request, this.env, !denied, "http", apiModuleLoads);
    return denied ?? (await instance(this)).fetch(request);
  }

  async scheduled(event) {
    if (!(this.env.LT_PRIVATE_API_ENABLED === 'true' && this.env.LT_MAINTENANCE_ENABLED === 'true') && this.env.LT_RETENTION_ENABLED !== 'true') return;
    return (await instance(this)).scheduled(event);
  }
}

export class LtOperator extends WorkerEntrypoint {
  async fetch() { return new Response('Not found', {status:404}); }

  async operate(context, request) {
    const denied = operatorResponse(this.env);
    const requestId = context?.requestId;
    traceSynthetic(request, this.env, !denied, 'operator', apiModuleLoads, requestId);
    try {
      const response = denied ?? await (await instance(this)).operator_request(context, request, this.env);
      traceOperatorResult(this.env, requestId, response.status);
      return response;
    } catch (error) {
      traceOperatorResult(this.env, requestId, 503);
      throw error;
    }
  }
}
