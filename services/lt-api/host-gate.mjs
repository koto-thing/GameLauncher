/**
 * キャッシュされない契約エラー応答を生成する
 *
 * @param code 契約のエラーコード
 * @param status HTTP ステータス
 * @returns 要求 ID を付けた JSON 応答
 */
const error = (code, status) =>
  Response.json(
    { error: { code, requestId: crypto.randomUUID() } },
    { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } },
  );

/**
 * 本人 API が明示的に無効な場合だけ早期拒否する
 *
 * @param env 本人 API とローカル認証の有効設定
 * @returns 無効時は501応答、それ以外は undefined として Rust の認証・状態検査へ進む
 */
export function privateResponse(env) {
  if (env.LT_PRIVATE_API_ENABLED !== "true" && env.LOCAL_AUTH !== "true")
    return error("NOT_IMPLEMENTED", 501);
}

/**
 * 本人 HTTP API と独立した設定で運営 RPC の有効状態を確認する
 *
 * @param env 運営 API とローカル認証の有効設定
 * @returns 無効時は501応答、それ以外は undefined
 */
export function operatorResponse(env) {
  if (env.LT_OPERATOR_API_ENABLED !== "true" && env.LOCAL_AUTH !== "true")
    return error("NOT_IMPLEMENTED", 501);
}

/**
 * 外部 HTTP から内部運営経路へのアクセスを拒否し、本人経路の設定を確認する
 *
 * @param request 外部 HTTP リクエスト
 * @param env API の有効設定
 * @returns 早期拒否の応答、後続処理へ渡す場合は undefined
 */
export function earlyResponse(request, env) {
  const path = new URL(request.url).pathname;
  if (path === "/api/lt/v1/operator" || path.startsWith("/api/lt/v1/operator/"))
    return error("NOT_FOUND", 404);
  if (
    path.startsWith("/api/lt/v1/auth/") ||
    path.startsWith("/api/lt/v1/applications") ||
    path === "/auth/verify" ||
    path === "/auth/email-change"
  )
    return privateResponse(env);
}
