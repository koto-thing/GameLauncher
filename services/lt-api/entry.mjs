// 信頼済み proxy は named service binding の operate のみを呼ぶ
// JSON 本文は解析せず Rust にそのまま渡す
import Api from './build/index.js';
export default Api;
export class LtOperator extends Api {
  async dispatchFake() { return super.fake_dispatch(this.env); }
  async fetch() { return new Response('Not found', { status: 404 }); }
  async operate(context, request) { return super.operator_request(context, request, this.env); }
}
