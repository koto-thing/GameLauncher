let calls = 0;
let rustSeen = false;
const seenRoutes = new Set();

// CPU比較時だけisolate内の初回を記録する。個人情報やqueryは記録しない
export function traceSynthetic(request, env, callsRust, scope = "http") {
  if (env.LT_SYNTHETIC_METRICS !== "true") return;
  const path = new URL(request.url).pathname;
  const route = scope === "operator" ? "operator-rpc"
    : path.startsWith("/api/lt/v1/events") ? "public-events"
    : path.startsWith("/api/lt/v1/auth/") ? "auth"
    : path.startsWith("/api/lt/v1/applications") ? "applications" : "other";
  console.log(JSON.stringify({ltCpuProbe:true,route,firstInIsolate:calls++===0,rustFirstInIsolate:callsRust&&!rustSeen,routeFirstInIsolate:!seenRoutes.has(route),callsRust}));
  if (callsRust) rustSeen = true;
  seenRoutes.add(route);
}
