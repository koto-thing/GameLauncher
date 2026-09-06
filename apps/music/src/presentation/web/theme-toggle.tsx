import { useLayoutEffect, useState } from "react";

type Theme = "light" | "dark";
const THEME_STORAGE_KEY = "pandd-music.theme";

/** @brief 保存済みの選択を優先し、未選択なら端末の配色設定を初期値にする。 */
function initialTheme(): Theme {
  // 保存が制限されるブラウザーでも表示や再生を妨げない。
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // ストレージが使えない場合も、その場での切り替えは提供する。
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** @brief ページや音声エンジンを再作成せず、サイト全体の配色だけを切り替える。 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useLayoutEffect(
    /** @brief Reactの描画直後にCSS変数とブラウザーのツールバー色を合わせる。 */ () => {
      document.documentElement.dataset.theme = theme;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute(
          "content",
          getComputedStyle(document.documentElement)
            .getPropertyValue("--paper")
            .trim(),
        );
    },
    [theme],
  );

  /** @brief 明示的な選択だけを保存し、保存不能でも現在の画面には即時反映する。 */
  function toggle(): void {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // セッション内のReact状態は維持し、権限エラーを未処理にしない。
    }
  }
  const nextLabel = theme === "dark" ? "ライト" : "ダーク";
  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={toggle}
      aria-label={`${nextLabel}モードに切り替える`}
      title={`現在：${theme === "dark" ? "ダーク" : "ライト"}モード`}
    >
      <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
      <span>{nextLabel}</span>
    </button>
  );
}
