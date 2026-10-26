import { useState } from "react";
import { Moon, Sun } from "lucide-react";

/** 保存済みの表示設定を切り替える */
export function ThemeToggle() {
  const [dark, setDark] = useState(document.documentElement.dataset.theme === "dark");

  // 保存できない環境でも、その画面では選択したテーマを適用する
  function toggle() {
    const next = !dark;
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try {
      localStorage.setItem("pandd-lt-theme", next ? "dark" : "light");
    } catch {
      /* 保存不可でも表示は切り替える */
    }
    setDark(next);
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={dark ? "ライトモードに切り替える" : "ダークモードに切り替える"}
      title={dark ? "ライトモードに切り替える" : "ダークモードに切り替える"}
    >
      {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </button>
  );
}
