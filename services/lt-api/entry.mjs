// 信頼済み proxy は named service binding の operate のみを呼ぶ
// JSON 本文は解析せず Rust にそのまま渡す
import Api from './build/index.js';
import { traceSynthetic } from './host-metrics.mjs';
import { earlyResponse, privateResponse } from './host-gate.mjs';
export default class LtHttp extends Api {
  async fetch(request) {
    const denied = earlyResponse(request,this.env);
    traceSynthetic(request, this.env, !denied);
    return denied ?? super.fetch(request);
  }
}
export class LtOperator extends Api {
  async dispatchFake() { return super.fake_dispatch(this.env); }
  async fetch() { return new Response('Not found', { status: 404 }); }
  async operate(context, request) { const denied=privateResponse(this.env); traceSynthetic(request,this.env,!denied,"operator"); return denied ?? super.operator_request(context, request, this.env); }
}

// 試験用Rust exportがあるbuildだけに受取口を作る
if (typeof Api.prototype.fake_mail === 'function') {
  LtOperator.prototype.testMail = function(email) { return Api.prototype.fake_mail.call(this, email, this.env); };
}

if (typeof Api.prototype.set_clock === 'function') {
  LtOperator.prototype.testClock = function(value) { return Api.prototype.set_clock.call(this, value, this.env); };
}

if (typeof Api.prototype.test_dispatch === 'function') {
  LtOperator.prototype.testDispatch = function(outcome) { return Api.prototype.test_dispatch.call(this, outcome, this.env); };
}

if(typeof Api.prototype.retention_test === "function"){LtOperator.prototype.testRetention=function(input){return Api.prototype.retention_test.call(this,this.env,input);};}

if (typeof Api.prototype.change_mail === 'function') {
  LtOperator.prototype.testChangeMail = function(email) { return Api.prototype.change_mail.call(this, email, this.env); };
}
