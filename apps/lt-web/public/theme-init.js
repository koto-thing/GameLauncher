// 初回描画前に表示設定を適用する
(() => {
  let saved;
  try {
    saved = localStorage.getItem("pandd-lt-theme");
  } catch {}
  document.documentElement.dataset.theme =
    saved === "light" || saved === "dark"
      ? saved
      : matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
})();
