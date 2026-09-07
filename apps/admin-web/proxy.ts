import { NextResponse, type NextRequest } from "next/server";
import { buildContentSecurityPolicy } from "./lib/csp.ts";

export { buildContentSecurityPolicy };

/**
 * 管理画面とAPIレスポンスへ共通のセキュリティヘッダーを付与する
 * @param request Next.jsから渡される受信リクエスト
 * @returns セキュリティヘッダーを設定した次のレスポンス
 */
export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", buildContentSecurityPolicy(undefined, request.nextUrl.pathname));
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  if (request.nextUrl.pathname.startsWith("/api/")) {
    response.headers.set("Cache-Control", "no-store, max-age=0");
    response.headers.set("Pragma", "no-cache");
  }
  return response;
}

// 全パスでproxyを実行し、APIだけキャッシュ無効化を追加する
export const proxyConfig = {
  matcher: ["/:path*"],
};
