
import { ThemeToggle } from "./ThemeToggle";

/** @brief 各サービスへの入口と共通の配色切り替えを表示する */
export function ServiceNavigation() {
  /* eslint-disable @next/next/no-html-link-for-pages -- 独立IIFE管理entryとvinextの境界ではページ全体を読み込む。 */
  return (
    <header className="service-header">
      <nav className="service-navigation" aria-label="サービスナビゲーション">
        <a href="/">ホーム</a>
        <a href="/intake">GameLauncher Uploader</a>
        <a href="/game">公開申請・設定</a>
        <a href="/editions">物理配布版</a>
        <a href="/music">Music Uploader</a>
      </nav>
      <ThemeToggle />
    </header>
  );
  /* eslint-enable @next/next/no-html-link-for-pages */
}
