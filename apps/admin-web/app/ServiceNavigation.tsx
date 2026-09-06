
/** @brief 各サービスとホームへの入口を表示する。操作権限は各APIで検証する。 */
export function ServiceNavigation() {
  // eslint-disable-next-line @next/next/no-html-link-for-pages -- 独立IIFE管理entryとvinextの境界ではページ全体を読み込む。
  return <nav className="service-navigation" aria-label="サービスナビゲーション"><a href="/">ホーム</a><a href="/intake">GameLauncher Uploader</a><a href="/game">公開申請・設定</a><a href="/music">Music Uploader</a></nav>;
}
