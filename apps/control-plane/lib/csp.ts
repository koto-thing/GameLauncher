export function buildContentSecurityPolicy(
  isDev: boolean = process.env.NODE_ENV === "development",
): string {
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'";

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self'",
    "font-src 'self'",
    "form-action 'self' https://github.com",
    "frame-ancestors 'none'",
    "img-src 'self' data: https://avatars.githubusercontent.com",
    "object-src 'none'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
  ].join("; ");
}
