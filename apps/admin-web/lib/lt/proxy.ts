import { requireRecentIdentity } from "@/lib/auth";
import { proxyLtCore, type LtInternalAdapter } from "./proxy-core";

/**
 * 既存認証をLT専用の内部接続に適用する
 *
 * @param request 要求
 * @param adapter 内部接続
 * @returns 応答
 */
export function proxyLt(
  request: Request,
  adapter?: LtInternalAdapter,
  metricsEnabled = false,
): Promise<Response> {
  return proxyLtCore(request, requireRecentIdentity, adapter, metricsEnabled);
}
