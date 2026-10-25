import { env } from "cloudflare:workers";
import { proxyLt } from "@/lib/lt/proxy";
import { ltInternalAdapter, type LtBindingEnv } from "@/lib/lt/internal-adapter";

/** @brief 既存認証を通した要求を内部RPCへ接続する @param request HTTP要求 @returns 管理応答 */
async function handle(request: Request): Promise<Response> {
  // binding未設定時は既存proxyの503で閉じる
  return proxyLt(request, ltInternalAdapter(env as unknown as LtBindingEnv));
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
