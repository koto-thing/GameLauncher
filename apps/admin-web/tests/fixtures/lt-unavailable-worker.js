import { WorkerEntrypoint } from "cloudflare:workers";

export class LtOperator extends WorkerEntrypoint {
  /**
   * LTを対象外とする検証で内部APIの利用不能を返す
   * @returns 固定の利用不能応答
   */
  operate() { return Response.json({ error: { code: "SERVICE_UNAVAILABLE" } }, { status: 503 }); }
}

export default {
  /**
   * 内部APIの公開HTTPアクセスを拒否する
   * @returns 非公開を示す応答
   */
  fetch() { return new Response("Not found", { status: 404 }); },
};
