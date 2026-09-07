/**
 * OriginとSec-Fetch-Siteを確認し、外部サイトからの書き込みを拒否する
 * @param request 検証対象のHTTPリクエスト
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new Response("Cross-origin write rejected", { status: 403 });
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new Response("Cross-site write rejected", { status: 403 });
  }
}

/**
 * ブラウザ由来の同一Origin書き込みであることを必須にする
 * @param request 検証対象のHTTPリクエスト
 */
export function assertBrowserWrite(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    throw new Response("Same-origin browser request required", { status: 403 });
  }
  assertSameOrigin(request);
}
