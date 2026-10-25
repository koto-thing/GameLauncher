const error = (code, status) => Response.json({error:{code,requestId:crypto.randomUUID()}},{status,headers:{"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});

// 明確に無効な場合だけ早期拒否する。許可・本人・role・状態検査はRustに残す
export function privateResponse(env) {
  if (env.LT_PRIVATE_API_ENABLED !== "true" && env.LOCAL_AUTH !== "true") return error("NOT_IMPLEMENTED",501);
}

export function earlyResponse(request, env) {
  const path = new URL(request.url).pathname;
  if (path === "/api/lt/v1/operator" || path.startsWith("/api/lt/v1/operator/")) return error("NOT_FOUND",404);
  if (path.startsWith("/api/lt/v1/auth/") || path.startsWith("/api/lt/v1/applications") || path === "/auth/verify" || path === "/auth/email-change") return privateResponse(env);
}
