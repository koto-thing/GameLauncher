let calls = 0;
let rustSeen = false;
let moduleMarker;
const seenRoutes = new Set();

// CPU比較時だけisolate内の初回を記録する。個人情報やqueryは記録しない
export function traceSynthetic(request, env, callsRust, scope = "http", wasmModuleLoads = null, requestId = null) {
  if (env.LT_SYNTHETIC_METRICS !== "true") return;
  moduleMarker ??= crypto.randomUUID();
  const path = new URL(request.url).pathname;
  const route = scope === "operator" ? "operator-rpc"
    : path.startsWith("/api/lt/v1/events") ? "public-events"
    : path.startsWith("/api/lt/v1/auth/") ? "auth"
    : path.startsWith("/api/lt/v1/applications") ? "applications" : "other";
  const probe = request.headers.get("X-LT-CPU-Probe");
  const sequence = request.headers.get("X-LT-CPU-Sequence");
  const identity = /^[a-f0-9]{32}$/.test(probe ?? "") && /^[1-9]$/.test(sequence ?? "") ? {probe,sequence:Number(sequence)} : {};
  const correlation = scope === "operator" && validRequestId(requestId) ? {requestId} : {};
  console.log(JSON.stringify({ltCpuProbe:true,...identity,...correlation,moduleMarker,requestInModule:++calls,wasmModuleLoads,wasmInstanceId:globalThis.__worker_init_state?.instanceId ?? null,route,firstInIsolate:calls===1,rustFirstInIsolate:callsRust&&!rustSeen,routeFirstInIsolate:!seenRoutes.has(route),callsRust}));
  if (callsRust) rustSeen = true;
  seenRoutes.add(route);
}

// 相関IDはproxyのサーバー生成UUIDだけを扱う。actorや要求本文を記録しない
function validRequestId(value) {
  return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
}

export function traceOperatorResult(env, requestId, status) {
  if (env.LT_SYNTHETIC_METRICS === "true" && validRequestId(requestId)) {
    console.log(JSON.stringify({ltOperatorRpc:true,requestId,status}));
  }
}
