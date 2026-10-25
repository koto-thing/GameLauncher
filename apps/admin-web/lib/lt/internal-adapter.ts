import type { OperatorContext } from "../../../../contracts/lt/v1";
import type { LtInternalAdapter } from "./proxy-core";

export type LtBindingEnv = { LT_INTERNAL?: { operate(context: OperatorContext, request: Request): Promise<Response> } };

/** @brief 内部entrypointのRPCだけへ接続する @param env Worker環境 @returns binding設定時のadapter、未設定時undefined */
export function ltInternalAdapter(env: LtBindingEnv): LtInternalAdapter | undefined {
  const binding = env.LT_INTERNAL;
  if (!binding) return undefined;

  // HTTP URLやブラウザーヘッダーを接続先の選択に使用しない
  return { fetch: (request, context) => binding.operate(context, request) };
}
