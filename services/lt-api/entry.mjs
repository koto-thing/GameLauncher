// 信頼済み proxy は named service binding の operate のみを呼ぶ
// JSON 本文は解析せず Rust にそのまま渡す
import Api from './build/index.js';
export default Api;
export class LtOperator extends Api {
  async dispatchFake() { return super.fake_dispatch(this.env); }
  async fetch() { return new Response('Not found', { status: 404 }); }
  async operate(context, request) { return super.operator_request(context, request, this.env); }
}

// 試験用Rust exportがあるbuildだけに受取口を作る
if (typeof Api.prototype.fake_mail === 'function') {
  LtOperator.prototype.testMail = function(email) { return Api.prototype.fake_mail.call(this, email, this.env); };
}

if (typeof Api.prototype.set_clock === 'function') {
  LtOperator.prototype.testClock = function(value) { return Api.prototype.set_clock.call(this, value, this.env); };
}
