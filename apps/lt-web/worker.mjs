// 静的assetはCloudflareから直接配信し、同一ホストのAPIだけRustへ渡す
export default {
  /**
   * 静的配信と公開 API を振り分け、内部運営経路を遮断する
   *
   * @param request ブラウザーからのリクエスト
   * @param env 静的配信・公開 API のバインディングと申請機能の設定
   * @returns 静的コンテンツ、API 応答、または公開用エラー応答
   */
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith("/api/lt/")) return env.ASSETS.fetch(request);
    if (path === "/api/lt/v1/operator" || path.startsWith("/api/lt/v1/operator/")) {
      return Response.json(
        { error: { code: "NOT_FOUND", requestId: crypto.randomUUID() } },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    // 閲覧専用設定では公開一覧と詳細の GET だけを許可する
    const applicationsEnabled = env.LT_APPLICATIONS_ENABLED === "true";
    const publicRead =
      request.method === "GET" &&
      /^\/api\/lt\/v1\/events(?:\/[^/]+(?:\/talks\/[^/]+)?)?$/.test(path);
    // 閲覧専用時は本人経路や書込みをRustへ渡さず、tokenやoutboxを作らない
    if (!applicationsEnabled && !publicRead) {
      return Response.json(
        { error: { code: "NOT_IMPLEMENTED", requestId: crypto.randomUUID() } },
        { status: 501, headers: { "Cache-Control": "no-store" } },
      );
    }

    // 公開 API への転送失敗は内部情報を含まない応答へ変換する
    try {
      if (!env.LT_PUBLIC) throw Error("Unavailable");
      // ブラウザー由来のactor/role/Authorizationを内部境界へ運ばない
      const headers = new Headers();
      if (applicationsEnabled)
        for (const name of ["content-type", "origin", "cookie", "x-lt-csrf"]) {
          const value = request.headers.get(name);
          if (value) headers.set(name, value);
        }

      // サーバー障害の本文を外部へ公開せず、契約のエラー形式にそろえる
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
