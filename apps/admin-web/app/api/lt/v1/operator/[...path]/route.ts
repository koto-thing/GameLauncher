import { proxyLt } from "@/lib/lt/proxy";

/** @brief 内部接続未設定の管理要求を認証後に閉じる @param request HTTP要求 @returns 管理応答 */
async function handle(request: Request): Promise<Response> {
  // 内部 binding の合意と設定が完了するまで閉じた状態に保つ
  return proxyLt(request);
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
