/** @brief ログイン後の遷移先を同一サイトの管理ページに限定する */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || (value.includes("\\") || [...value].some(character => character.charCodeAt(0) <= 32))) return "/";

  const url = new URL(value, "https://admin.invalid");
  if (url.origin !== "https://admin.invalid" || /^\/(?:login|api)(?:\/|$)/.test(url.pathname)) return "/";

  return `${url.pathname}${url.search}${url.hash}`;
}

/** @brief 戻り先を保持した共通ログインページのURLを作る */
export function loginUrl(returnTo: string): string {
  return `/login?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;
}

/** @brief 管理ページを保護し、認証・招待・静的ファイルは通す */
export function isManagementPage(pathname: string): boolean {
  return pathname === "/" || /^\/(?:game|intake|editions|music|lt|members|analytics|access)(?:\/|$)/.test(pathname);
}
