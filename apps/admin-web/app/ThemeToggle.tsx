"use client";

import { useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY } from "@/lib/theme";

/** @brief 初回描画で設定された配色と、切り替え後の配色をReactへ通知する */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  return () => observer.disconnect();
}

/** @brief CSSが現在使っている配色を読み取る */
function isDark(): boolean {
  return document.documentElement.dataset.theme === "dark";
}

/** @brief サーバー描画とhydration時のボタン表示を一致させる */
function serverSnapshot(): boolean {
  return false;
}

/** @brief フォームの入力状態を維持しながら管理画面全体の配色を切り替える */
export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, isDark, serverSnapshot);
  const nextLabel = dark ? "ライト" : "ダーク";

  /** @brief 配色を即時反映し、保存が許可されているブラウザーでは選択を記憶する */
  function toggle(): void {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.themePreference = next;
    document.documentElement.dataset.theme = next;

    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // 保存が制限されていても現在の画面では選択した配色を維持する
    }
  }

  return (
    <button className="theme-toggle" type="button" onClick={toggle}
      aria-label={`${nextLabel}モードに切り替える`} title={`現在：${dark ? "ダーク" : "ライト"}モード`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {dark ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>
          : <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" />}
      </svg>
      <span>{nextLabel}</span>
    </button>
  );
}
