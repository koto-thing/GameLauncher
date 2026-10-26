let calls = 0;
let rustSeen = false;
let moduleMarker;
const seenRoutes = new Set();

/**
 * CPU 比較用に実行環境内の初回呼出を記録する
 *
 * @param request 経路と計測ヘッダーを参照するリクエスト
 * @param env 計測の有効設定
 * @param callsRust Rust を呼び出す場合は true
 * @param scope HTTP または運営 RPC の計測区分
 * @param wasmModuleLoads Wasm モジュールの読込回数、未取得時は null
 * @param requestId 運営プロキシが発行した要求 ID
 * @returns 戻り値なし
 */
export function traceSynthetic(
  request,
  env,
  callsRust,
  scope = "http",
  wasmModuleLoads = null,
  requestId = null,
) {
  if (env.LT_SYNTHETIC_METRICS !== "true") return;
  moduleMarker ??= crypto.randomUUID();
  const path = new URL(request.url).pathname;
  const route =
    scope === "operator"
      ? "operator-rpc"
      : path.startsWith("/api/lt/v1/events")
        ? "public-events"
        : path.startsWith("/api/lt/v1/auth/")
          ? "auth"
          : path.startsWith("/api/lt/v1/applications")
            ? "applications"
            : "other";

  // 個人情報やクエリを含めず、形式を検証した計測用識別子だけを採用する
  const probe = request.headers.get("X-LT-CPU-Probe");
  const sequence = request.headers.get("X-LT-CPU-Sequence");
  const identity =
    /^[a-f0-9]{32}$/.test(probe ?? "") && /^[1-9]$/.test(sequence ?? "")
      ? { probe, sequence: Number(sequence) }
      : {};
  const correlation = scope === "operator" && validRequestId(requestId) ? { requestId } : {};
  console.log(
    JSON.stringify({
      ltCpuProbe: true,
      ...identity,
      ...correlation,
      moduleMarker,
      requestInModule: ++calls,
      wasmModuleLoads,
      wasmInstanceId: globalThis.__worker_init_state?.instanceId ?? null,
      route,
      firstInIsolate: calls === 1,
      rustFirstInIsolate: callsRust && !rustSeen,
      routeFirstInIsolate: !seenRoutes.has(route),
      callsRust,
    }),
  );

  // ログ出力後に初回判定の状態を更新する
  if (callsRust) rustSeen = true;
  seenRoutes.add(route);
}

/**
 * 相関 ID が UUID v4 の形式か検証する
 *
 * @param value 検証する要求 ID
 * @returns UUID v4 の文字列の場合は true
 */
function validRequestId(value) {
  return (
    typeof value === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
  );
}

/**
 * 計測が有効な場合に運営 RPC の要求 ID と結果を記録する
 *
 * @param env 計測の有効設定
 * @param requestId 運営プロキシが発行した要求 ID
 * @param status 結果の HTTP ステータス
 * @returns 戻り値なし
 */
export function traceOperatorResult(env, requestId, status) {
  if (env.LT_SYNTHETIC_METRICS === "true" && validRequestId(requestId)) {
    console.log(JSON.stringify({ ltOperatorRpc: true, requestId, status }));
  }
}
