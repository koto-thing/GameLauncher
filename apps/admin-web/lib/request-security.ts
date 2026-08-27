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

export function assertBrowserWrite(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    throw new Response("Same-origin browser request required", { status: 403 });
  }
  assertSameOrigin(request);
}
