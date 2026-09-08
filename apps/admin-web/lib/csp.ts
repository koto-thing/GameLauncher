/**
 * パスと実行環境に応じたContent-Security-Policyを生成する
 * @param isDev 開発用のunsafe-evalを許可するか
 * @param pathname Music管理画面など、追加の実行要件を持つパス
 * @returns セミコロン区切りのCSPポリシー
 */
export function buildContentSecurityPolicy(
  isDev: boolean = process.env.NODE_ENV === "development",
  pathname: string = "",
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
    "img-src 'self' blob: data: https://avatars.githubusercontent.com",
    "object-src 'none'",
    scriptSrc + (pathname === "/music" ? " 'wasm-unsafe-eval'" : ""),
    "style-src 'self' 'unsafe-inline'",
  ].join("; ");
}
