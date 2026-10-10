// 管理画面全体で一つの明示的な配色選択を保存する
export const THEME_STORAGE_KEY = "pandd-admin.theme";

// 初回描画前に保存済みの選択、未選択なら端末の配色設定を適用する
export const THEME_INIT_SCRIPT = `(() => {
  let theme;
  try { theme = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)}); } catch {}
  const root = document.documentElement;
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  root.dataset.themePreference = theme === "light" || theme === "dark" ? theme : "system";

  // 手動選択がない間だけ、端末の配色設定に追従する
  const applyTheme = () => {
    root.dataset.theme = root.dataset.themePreference === "system"
      ? media.matches ? "dark" : "light"
      : root.dataset.themePreference;
  };

  applyTheme();
  media.addEventListener("change", applyTheme);
})();`;
