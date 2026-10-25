// 静的assetはCloudflareから直接配信し、同一ホストのAPIだけRustへ渡す
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith("/api/lt/")) return env.ASSETS.fetch(request);
    if (path === "/api/lt/v1/operator" || path.startsWith("/api/lt/v1/operator/")) {
      return Response.json(
        { error: { code: "NOT_FOUND", requestId: crypto.randomUUID() } },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    try {
      if (!env.LT_PUBLIC) throw Error("Unavailable");
      // ブラウザー由来のactor/role/Authorizationを内部境界へ運ばない
      const headers = new Headers();
      for (const name of ["content-type", "origin", "cookie", "x-lt-csrf"]) {
        const value = request.headers.get(name);
        if (value) headers.set(name, value);
      }
      const response = await env.LT_PUBLIC.fetch(new Request(request, { headers }));
      if (response.status < 500) return response;
      const code = response.status === 501 ? "NOT_IMPLEMENTED" : "SERVICE_UNAVAILABLE";
      return Response.json(
        { error: { code, requestId: crypto.randomUUID() } },
        { status: response.status === 501 ? 501 : 503, headers: { "Cache-Control": "no-store" } },
      );
    } catch {
      return Response.json(
        { error: { code: "SERVICE_UNAVAILABLE", requestId: crypto.randomUUID() } },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  },
};
