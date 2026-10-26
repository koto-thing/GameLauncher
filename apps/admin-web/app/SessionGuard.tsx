"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { isManagementPage, loginUrl } from "@/lib/login-navigation";

/** @brief 管理画面表示中の期限切れを検知し、元のURLを共通ログインへ渡す */
export function SessionGuard() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || !isManagementPage(pathname)) return;

    const controller = new AbortController();

    // 表示中だけ確認し、通信障害をログアウトと取り違えない
    async function checkSession() {
      if (document.visibilityState !== "visible") return;

      try {
        const response = await fetch("/api/auth/session", { cache: "no-store", signal: controller.signal });
        if (response.status === 401 && !controller.signal.aborted) {
          window.location.replace(loginUrl(window.location.pathname + window.location.search + window.location.hash));
        }
      } catch { /* 次の表示・定期確認で再試行する */ }
    }

    void checkSession();
    const interval = window.setInterval(checkSession, 60_000);
    document.addEventListener("visibilitychange", checkSession);
    window.addEventListener("focus", checkSession);

    return () => {
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", checkSession);
      window.removeEventListener("focus", checkSession);
    };
  }, [pathname]);

  return null;
}
